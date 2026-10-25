// Populate 5 mock reimbursement requests — an agency-sponsored Mint Mobile family plan,
// one $150/mo bill split into 5 equal $30 line shares, one per client.
// Run from the project root:  npx tsx scripts/seed-mint.ts
import { loadEnv } from "./env";
import { db, schema } from "../src/db/client";
import { createRequest, currentMode } from "../src/lib/pipeline";

const VENDOR = "Mint Mobile";
const CATEGORY = "phone" as const;        // valid category; $120 batch limit, no bank-posting required
const PLAN_TOTAL_CENTS = 15000;           // $150.00/mo family plan
const LINES = 5;                          // split equally across 5 clients
const STATEMENT_DATE = "2026-10-18";
const SHARE = Math.round(PLAN_TOTAL_CENTS / LINES); // $30.00 each

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

function receipt(line: number, shareCents: number) {
  return [
    "MINT MOBILE",
    `Statement date: ${STATEMENT_DATE}`,
    `Account: Agency family plan (${LINES} lines)`,
    `Line ${line} of ${LINES} — Unlimited`,
    `Plan total: ${usd(PLAN_TOTAL_CENTS)} / mo  (${LINES} lines @ ${usd(shareCents)})`,
    `Amount due (this line): ${usd(shareCents)}`,
  ].join("\n");
}

async function main() {
  loadEnv(); process.env.MODE = process.env.MODE ?? "MOCK";
  console.log(`mode ${currentMode()}`);
  const clients = db.select().from(schema.clients).all();
  if (clients.length < LINES) throw new Error(`need ${LINES} clients, found ${clients.length} — run \`npm run seed\` first`);
  const picks = clients.slice(0, LINES);
  const rows: { client: string; line: string; share: string; outcome: string }[] = [];
  for (let i = 0; i < LINES; i++) {
    const c = picks[i];
    const line = i + 1;
    const decision = await createRequest({
      clientId: c.id,
      category: CATEGORY,
      requestedCents: SHARE,
      vendorNameRaw: VENDOR,
      caseNote: `Reimbursement for this client's share of the agency-sponsored ${VENDOR} family plan — line ${line} of ${LINES}. Plan is ${usd(PLAN_TOTAL_CENTS)}/mo across ${LINES} lines (${usd(SHARE)} each).`,
      rawText: receipt(line, SHARE),
    });
    rows.push({ client: c.displayName, line: `${line}/${LINES}`, share: usd(SHARE), outcome: decision.outcome });
  }
  console.table(rows);
  console.log(`created ${rows.length} ${CATEGORY} requests · ${VENDOR} family plan ${usd(PLAN_TOTAL_CENTS)}/mo split ${LINES} ways (${usd(SHARE)} each)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
