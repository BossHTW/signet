// One-time Capital One Nessie setup: customer + checking account, then push the seeded bank feed as purchases.
// Run: npm run nessie:setup   (add --reset to create a fresh account)
import fs from "node:fs";
import { loadEnv } from "./env";
import { nessieSetup, nessiePushSeed } from "../src/lib/adapters/nessie";
import { generate } from "./generate";

async function main() {
  loadEnv();
  if (!process.env.NESSIE_API_KEY) throw new Error("NESSIE_API_KEY missing in .env.local");
  const s = await nessieSetup();
  console.log(`Nessie customer ${s.customerId} · account ${s.accountId}`);
  const seed = generate();
  const n = await nessiePushSeed(seed.bank, (d, t) => { if (d % 10 === 0 || d === t) process.stdout.write(`  pushed ${d}/${t}\r`); });
  console.log(`\npushed ${n} postings. Set MODE=LIVE and the bank feed + transfers go through Nessie (https://api.nessieisreal.com).`);
}
main().catch((e) => { console.error(e.message ?? e); if (e.cause) console.error("cause:", e.cause.code ?? e.cause.message ?? e.cause); process.exit(1); });
