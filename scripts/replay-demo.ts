// Runs every seeded request through the engines with the truth extractor and prints the metrics.
// Proves the deterministic layer end to end without the LLM or any network. Run: npm run demo:replay
import { runWorld } from "../tests/harness";

const world = runWorld();
const n = world.length;
const approved = world.filter((o) => o.result.decision.outcome === "APPROVED").length;
const escalated = n - approved;
const planted = world.filter((o) => o.req.plantedAnomaly);
const caught = planted.filter((o) => o.result.decision.outcome !== "APPROVED");
const byCode: Record<string, number> = {};
for (const o of world) for (const t of o.result.decision.triggers) byCode[t.code] = (byCode[t.code] ?? 0) + 1;

console.log(`Signet replay — ${n} requests`);
console.log(`  auto-approved: ${approved} (${((approved / n) * 100).toFixed(1)}%)   escalated to human: ${escalated}`);
console.log(`  planted anomalies: ${planted.length}   caught: ${caught.length}`);
console.log(`  triggers by code:`, byCode);
console.log("");
for (const o of world.filter((o) => o.result.decision.outcome === "ESCALATED")) {
  console.log(`  ${o.req.id}  ${o.req.category.padEnd(9)} $${(o.req.requestedCents / 100).toFixed(2).padStart(8)}  ${(o.req.plantedAnomaly ?? "").padEnd(22)} ${o.result.decision.triggers.map((t) => t.code).join(", ")}`);
}
