// Processes every NEW request through the real pipeline (DB + adapters + extractor by MODE). Run: npm run process
import { processAllPending } from "../src/lib/pipeline";
import { computeMetrics } from "../src/lib/metrics";
import { generateReports } from "../src/lib/reports";
import { verifyChain } from "../src/lib/audit";

async function main() {
const t0 = Date.now();
const out = await processAllPending();
generateReports();
const m = computeMetrics();
console.log(`processed ${out.length} in ${Date.now() - t0} ms · mode ${m.mode}`);
console.log(`  verified-ready ${m.readyPct}% · escalated ${m.escalatedPct}% · planted ${m.anomaliesPlanted} caught ${m.anomaliesCaught}`);
console.log(`  triggers`, m.caughtByCode);
console.log(`  llm calls ${m.llmCalls} · cache hits ${m.llmCacheHits} · est spend $${m.spendUsd}`);
console.log(`  audit chain`, verifyChain());
}
main().catch((e) => { console.error(e); process.exit(1); });
