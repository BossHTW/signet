import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { Metrics, TriggerCode } from "@/db/types";
import { median, pct, tally } from "@/lib/engine/util";
import { llmStats } from "@/lib/llm/cache";
import { currentMode } from "@/lib/adapters";

const MANUAL_REVIEW_HOURS = 0.4; // assumption, shown in the UI

export function computeMetrics(): Metrics & { assumptions: Record<string, string> } {
  const decisions = db.select().from(schema.decisions).all();
  const requests = db.select().from(schema.requests).all();
  const n = decisions.length;
  const sys = decisions.filter((d) => d.decidedBy === "SYSTEM" && d.outcome === "APPROVED").length;
  const denied = decisions.filter((d) => d.outcome === "DENIED").length;
  const humanTouched = decisions.filter((d) => d.decidedBy === "HUMAN" || d.outcome === "ESCALATED").length;
  const planted = requests.filter((r) => r.plantedAnomaly);
  const caught = planted.filter((r) => {
    const d = decisions.find((x) => x.requestId === r.id);
    return d && (d.decidedBy === "HUMAN" || d.outcome !== "APPROVED");
  });
  return {
    processed: n,
    autoApprovedPct: pct(sys, n),
    escalatedPct: pct(humanTouched, n),
    deniedPct: pct(denied, n),
    medianDecisionMs: median(decisions.map((d) => d.decisionMs)),
    anomaliesPlanted: planted.length,
    anomaliesCaught: caught.length,
    caughtByCode: tally(decisions.flatMap((d) => d.triggers.map((t) => t.code as TriggerCode))),
    staffHoursSavedPer100: Math.round(pct(sys, n) * MANUAL_REVIEW_HOURS * 10) / 10,
    llmCalls: llmStats.calls,
    llmCacheHits: llmStats.hits,
    spendUsd: Math.round(llmStats.spendUsd * 100) / 100,
    mode: currentMode(),
    assumptions: { staffHoursSavedPer100: `${MANUAL_REVIEW_HOURS} h manual review per request avoided for each auto-approval (assumption)` },
  };
}

export function plantedStatus() {
  const planted = db.select().from(schema.requests).where(eq(schema.requests.status, schema.requests.status)).all().filter((r) => r.plantedAnomaly);
  return planted.map((r) => {
    const d = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, r.id)).get();
    return { requestId: r.id, label: r.plantedAnomaly!, outcome: d?.outcome ?? "pending", decidedBy: d?.decidedBy ?? "-", codes: d?.triggers.map((t) => t.code) ?? [] };
  });
}
