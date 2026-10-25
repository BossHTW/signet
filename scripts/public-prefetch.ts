// Pre-fetch public records for every known vendor (Bright Data) and the HUD rent benchmark, into data/cache/public.
// Run once with keys set: npm run public:prefetch   — then the demo never waits on the web.
import fs from "node:fs";
import { loadEnv } from "./env";
import { vendorPublicRecord, rentBenchmark, publicStats } from "../src/lib/adapters/public";
import { generate } from "./generate";

async function main() {
  loadEnv();
  process.env.MODE = "LIVE";
  const seed = generate();
  const fmr = await rentBenchmark();
  console.log(`FMR 1br $${(fmr.fmrCents["1br"] / 100).toFixed(0)} · ${fmr.source}`);
  for (const v of seed.vendors) {
    const t0 = Date.now();
    const r = await vendorPublicRecord(v.legalName, { force: true });
    console.log(`${v.legalName.padEnd(34)} sf:${r.sfBusiness ? (r.sfBusiness.found ? `yes(${r.sfBusiness.count})` : "no") : "—"}  web:${r.web ? (r.web.found ? "yes" : "no") : "—"}  ${r.source}  ${((Date.now() - t0) / 1000).toFixed(1)}s ${r.errors.length ? "⚠ " + r.errors.join(" | ") : ""}`);
  }
  console.log(`\ncalls ${publicStats.calls} · cache hits ${publicStats.cacheHits} · failures ${publicStats.failures}`);
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
