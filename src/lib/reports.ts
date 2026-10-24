import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db/client";
import type { ReportRow } from "@/db/types";
import { appendAudit } from "@/lib/audit";

/** Per-grant compliance report from decided requests. Idempotent: regenerates for all grants. */
export function generateReports() {
  const grants = db.select().from(schema.grantStreams).all();
  const decisions = db.select({ d: schema.decisions, r: schema.requests }).from(schema.decisions).innerJoin(schema.requests, eq(schema.decisions.requestId, schema.requests.id)).all();
  const at = new Date().toISOString();
  db.delete(schema.complianceReports).run();
  const out = [];
  for (const g of grants) {
    const rows: ReportRow[] = [];
    for (const { d, r } of decisions) {
      const alloc = d.allocation.find((a) => a.grantId === g.id);
      const touches = alloc || (d.outcome !== "APPROVED" && (d.policyResult as { eligibleGrants?: string[] }).eligibleGrants?.[0] === g.id);
      if (!touches) continue;
      rows.push({ requestId: r.id, clientId: r.clientId, category: r.category, cents: alloc?.cents ?? 0, decidedBy: d.decidedBy, outcome: d.outcome, triggers: d.triggers.map((t) => t.code), sealHash: d.seal.hash });
    }
    const totals = {
      cents: rows.filter((x) => x.outcome === "APPROVED").reduce((s, x) => s + x.cents, 0),
      count: rows.length,
      escalated: rows.filter((x) => x.outcome === "ESCALATED").length,
      denied: rows.filter((x) => x.outcome === "DENIED").length,
    };
    const rep = { id: nanoid(10), grantId: g.id, periodStart: g.periodStart, periodEnd: g.periodEnd, rows, totals, generatedAt: at };
    db.insert(schema.complianceReports).values(rep).run();
    out.push({ ...rep, grant: g });
  }
  appendAudit({ type: "REPORT_GENERATED", actor: "system", requestId: null, payload: { grants: out.length, at } });
  return out;
}

export function reportsCsv(): string {
  const reps = db.select().from(schema.complianceReports).all();
  const lines = ["grant,request_id,client_id,category,cents,decided_by,outcome,triggers,seal_hash"];
  for (const rep of reps) for (const r of rep.rows) lines.push([rep.grantId, r.requestId, r.clientId, r.category, r.cents, r.decidedBy, r.outcome, r.triggers.join("|"), r.sealHash].join(","));
  return lines.join("\n");
}
