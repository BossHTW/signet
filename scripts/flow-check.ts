// End-to-end control-flow check with no UI: run agent → nothing paid → deny one → open batch → attest sample → certify → release by a different person.
// Run: npm run flow   (uses the current data/signet.db; run `npm run seed` first for a clean one)
import { loadEnv } from "./env";
import { db, schema } from "../src/db/client";
import { eq } from "drizzle-orm";
import { processAllPending, openBatch, attestItem, certifyBatch, releaseBatch, humanDecide } from "../src/lib/pipeline";
import { verifyChain } from "../src/lib/audit";
import { computeMetrics } from "../src/lib/metrics";

async function main() {
  loadEnv(); process.env.MODE = process.env.MODE ?? "MOCK";
  const paidBefore = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "PAYMENT_SENT")).all().length;
  await processAllPending();
  const st = () => Object.entries(db.select({ s: schema.requests.status }).from(schema.requests).all().reduce((m, r) => ((m[r.s] = (m[r.s] ?? 0) + 1), m), {} as Record<string, number>)).map(([k, v]) => `${k}=${v}`).join(" ");
  console.log("after agent:", st());
  const paid = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "PAYMENT_SENT")).all().length - paidBefore;
  if (paid) throw new Error(`agent paid ${paid} items on its own`);
  const dup = db.select().from(schema.requests).all().find((x) => x.plantedAnomaly?.toLowerCase().includes("dup") && x.status === "ESCALATED");
  if (dup) { await humanDecide({ requestId: dup.id, humanId: "program.supervisor", outcome: "DENIED", rationale: "Same receipt filed twice." }); console.log(`denied ${dup.id} (${dup.plantedAnomaly}) by program.supervisor`); }
  const id = openBatch("program.supervisor");
  const b = db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.id, id)).get()!;
  console.log(`batch ${id}: ${b.itemIds.length} items, $${(b.totalCents / 100).toFixed(0)}, sample ${b.sampleIds.length}`);
  let threw = false; try { certifyBatch({ batchId: id, humanId: "program.supervisor" }); } catch (e) { threw = true; console.log("certify before reading →", (e as Error).message); }
  if (!threw) throw new Error("certified without reading the sample");
  for (const rid of b.sampleIds) attestItem({ batchId: id, requestId: rid, humanId: "program.supervisor" });
  certifyBatch({ batchId: id, humanId: "program.supervisor" });
  threw = false; try { await releaseBatch({ batchId: id, humanId: "program.supervisor" }); } catch (e) { threw = true; console.log("same-person release →", (e as Error).message); }
  if (!threw) throw new Error("certifier released own batch");
  const sent = await releaseBatch({ batchId: id, humanId: "finance.director" });
  console.log(`released ${sent} payments;`, st());
  const m = computeMetrics();
  console.log(`metrics: ready ${m.readyPct}% · certified ${m.certified} · attested ${m.attested} · released ${m.released} · anomalies ${m.anomaliesCaught}/${m.anomaliesPlanted} · autonomous payments ${m.autonomousPayments}`);
  console.log("audit chain", verifyChain());
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
