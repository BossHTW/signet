import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { Metrics, TriggerCode } from "@/db/types";
import { median, pct, tally } from "@/lib/engine/util";
import { llmStats } from "@/lib/llm/cache";
import { currentMode } from "@/lib/adapters";
import { publicStats } from "@/lib/adapters/public";
import { memoryStats } from "@/lib/adapters/memory";
import fs from "node:fs";

const MANUAL_REVIEW_HOURS = 0.4; // assumption, shown in the UI

export function computeMetrics(): Metrics & { assumptions: Record<string, string>; publicRecordsCached: number; publicCalls: number; memorySource: string } {
  const decisions = db.select().from(schema.decisions).all();
  const requests = db.select().from(schema.requests).all();
  const n = decisions.length;
  // "ready" = the system verified it clean and batch-eligible. Humans still certify and release every one of them.
  const ready = decisions.filter((d) => d.outcome === "READY" || (d.decidedBy === "HUMAN" && /^Certified in batch/.test(d.rationale ?? ""))).length;
  const denied = decisions.filter((d) => d.outcome === "DENIED").length;
  const escalated = n - ready;
  const certified = decisions.filter((d) => d.outcome === "APPROVED" && d.decidedBy === "HUMAN").length;
  const released = requests.filter((r) => r.status === "RELEASED").length;
  const attested = db.select().from(schema.releaseBatches).all().reduce((s, b) => s + b.attestedIds.length, 0);
  const planted = requests.filter((r) => r.plantedAnomaly);
  const caught = planted.filter((r) => {
    const d = decisions.find((x) => x.requestId === r.id);
    return d && (d.decidedBy === "HUMAN" || d.outcome !== "READY");
  });
  return {
    processed: n,
    readyPct: pct(ready, n),
    escalatedPct: pct(escalated, n),
    certified, released, attested, autonomousPayments: 0,
    deniedPct: pct(denied, n),
    medianDecisionMs: median(decisions.map((d) => d.decisionMs)),
    anomaliesPlanted: planted.length,
    anomaliesCaught: caught.length,
    caughtByCode: tally(decisions.flatMap((d) => d.triggers.map((t) => t.code as TriggerCode))),
    staffHoursSavedPer100: Math.round(pct(ready, n) * MANUAL_REVIEW_HOURS * 10) / 10,
    llmCalls: llmStats.calls,
    llmCacheHits: llmStats.hits,
    spendUsd: Math.round(llmStats.spendUsd * 100) / 100,
    mode: currentMode(),
    assumptions: { staffHoursSavedPer100: `${MANUAL_REVIEW_HOURS} h of line-by-line review avoided for each system-verified item certified in a sampled batch (assumption)` },
    publicRecordsCached: (() => { try { return fs.readdirSync("data/cache/public").filter((f) => f.endsWith(".json")).length; } catch { return 0; } })(),
    publicCalls: publicStats.calls,
    memorySource: memoryStats.lastQuerySource,
  };
}

export function plantedStatus() {
  const planted = db.select().from(schema.requests).where(eq(schema.requests.status, schema.requests.status)).all().filter((r) => r.plantedAnomaly);
  return planted.map((r) => {
    const d = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, r.id)).get();
    return { requestId: r.id, label: r.plantedAnomaly!, outcome: d?.outcome ?? "pending", decidedBy: d?.decidedBy ?? "-", codes: d?.triggers.map((t) => t.code) ?? [] };
  });
}
