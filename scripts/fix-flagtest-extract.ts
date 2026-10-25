// Inject a clean, high-confidence extraction for the fake-vendor test requests and reprocess them,
// so they escalate on MATCH-LOW ONLY (no EXTRACT-LOW from the offline heuristic fallback).
// Run:  MODE=MOCK npx tsx scripts/fix-flagtest-extract.ts
import { like, or, eq } from "drizzle-orm";
import { loadEnv } from "./env";
import { db, schema } from "../src/db/client";
import { processRequest, currentMode } from "../src/lib/pipeline";

async function main() {
  loadEnv(); process.env.MODE = process.env.MODE ?? "MOCK";
  console.log(`mode ${currentMode()}`);
  const reqs = db.select().from(schema.requests)
    .where(or(like(schema.requests.vendorNameRaw, "Trailhead%"), like(schema.requests.vendorNameRaw, "Mesa Verde%"))).all();
  const rows: any[] = [];
  for (const r of reqs) {
    const docs = db.select().from(schema.documents).where(eq(schema.documents.requestId, r.id)).all();
    const extracted = {
      vendorName: { value: r.vendorNameRaw, confidence: 0.97, evidence: "Vendor line on receipt" },
      amountCents: { value: r.requestedCents, confidence: 0.98, evidence: "Total line on receipt" },
      date: { value: "2026-10-21", confidence: 0.95, evidence: "Date line on receipt" },
    };
    for (const d of docs) {
      db.update(schema.documents).set({ extracted: extracted as any, extractedAt: new Date().toISOString(), model: "manual-clean" })
        .where(eq(schema.documents.id, d.id)).run();
    }
    const dec: any = await processRequest(r.id, { reprocess: true });
    const trs = Array.isArray(dec.triggers) ? dec.triggers : JSON.parse(String(dec.triggers ?? "[]"));
    rows.push({ vendor: r.vendorNameRaw, amount: `$${(r.requestedCents/100).toFixed(2)}`, outcome: dec.outcome, triggers: trs.map((t: any) => t.code).join(",") || "—" });
  }
  console.table(rows);
  const bad = rows.filter((x) => !(x.outcome === "ESCALATED" && x.triggers === "MATCH-LOW"));
  console.log(bad.length === 0 ? "ALL MATCH-LOW only ✓" : `still not clean: ${JSON.stringify(bad)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
