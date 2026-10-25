// scripts/seed-flagtest.ts
// Fake-vendor test set: requests that escalate on MATCH-LOW ONLY, so an
// allow_within_limit rule on request.vendorNameRaw flips the whole vendor's set.
// MATCH-LOW only: transit (no BANK-LOW; amount-only extraction; $100 limit);
// unseeded vendor -> crs=null -> crsStatus UNKNOWN (no VENDOR-FLAG);
// pre-seeded public cache (web present, no SF row) so PUBLIC-NONE can't fire;
// distinct amounts (no DUP-HIT); transit-eligible clients (single-grant alloc).
// Idempotent: skips a (vendor,client) that already exists; finalizes an orphan
// (request with no decision) by reprocessing it. Runs offline in MOCK.
// Run:  MODE=MOCK npx tsx scripts/seed-flagtest.ts
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { and, eq } from "drizzle-orm";
import { loadEnv } from "./env";
import { db, schema } from "../src/db/client";
import { createRequest, processRequest, currentMode } from "../src/lib/pipeline";

const CATEGORY = "transit" as const;
const CACHE_DIR = path.join(process.cwd(), "data", "cache", "public");
const VENDORS = ["Trailhead Mobility Collective", "Mesa Verde Rideshare Co"];
const AMOUNTS = [4250, 5800, 3725, 6400, 4875, 5550, 3900, 6125];

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const keyFor = (name: string) =>
  createHash("sha256").update(JSON.stringify(["vendor", name.toLowerCase().replace(/\s+/g, " ").trim()])).digest("hex");

function seedPublicCache(name: string) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  fs.writeFileSync(path.join(CACHE_DIR, keyFor(name) + ".json"), JSON.stringify({
    vendorQuery: name, sfBusiness: null,
    web: { found: true, results: [{ title: `${name} — official site`, link: `https://${slug}.example.com`, displayLink: `${slug}.example.com` }], source: "Google via Bright Data" },
    fetchedAt: new Date().toISOString(), source: "BRIGHTDATA", errors: [],
  }, null, 2));
}

const receipt = (vendor: string, cents: number) =>
  ["RECEIPT", `Vendor: ${vendor}`, "Date: 2026-10-21", "Service: Local transit fare (youth program outing)", `Total: ${usd(cents)}`].join("\n");

async function main() {
  loadEnv(); process.env.MODE = process.env.MODE ?? "MOCK";
  console.log(`mode ${currentMode()}`);

  const raw = new Database("data/signet.db", { readonly: true });
  const eligible = raw.prepare(
    "select distinct r.client_id as id, c.display_name as name from requests r " +
    "join decisions d on d.request_id = r.id join clients c on c.id = r.client_id " +
    "where r.category = 'transit' and (d.outcome = 'READY' or d.outcome = 'APPROVED') and (d.triggers = '[]' or d.triggers is null)"
  ).all() as { id: string; name: string }[];
  raw.close();
  if (eligible.length < 2) throw new Error(`need >=2 transit-eligible clients, found ${eligible.length}`);

  const splitA = Math.ceil(eligible.length * 0.6);
  const plan = eligible.map((c, i) => ({ vendor: i < splitA ? VENDORS[0] : VENDORS[1], client: c, cents: AMOUNTS[i % AMOUNTS.length] }));
  for (const v of VENDORS) seedPublicCache(v);

  const rows: { vendor: string; client: string; amount: string; outcome: string; triggers: string; note: string }[] = [];
  for (const p of plan) {
    const existing = db.select().from(schema.requests)
      .where(and(eq(schema.requests.vendorNameRaw, p.vendor), eq(schema.requests.clientId, p.client.id))).get();
    let decision: any; let note = "created";
    if (existing) {
      const dec = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, existing.id)).get();
      if (dec) { decision = dec; note = "exists"; }
      else { decision = await processRequest(existing.id, { reprocess: true }); note = "finalized-orphan"; }
    } else {
      decision = await createRequest({
        clientId: p.client.id, category: CATEGORY, requestedCents: p.cents, vendorNameRaw: p.vendor,
        caseNote: `Transit reimbursement for a youth program outing (vendor "${p.vendor}").`,
        rawText: receipt(p.vendor, p.cents),
      });
    }
    const trs = Array.isArray(decision.triggers) ? decision.triggers : JSON.parse(String(decision.triggers ?? "[]"));
    rows.push({ vendor: p.vendor, client: p.client.name, amount: usd(existing?.requestedCents ?? p.cents), outcome: decision.outcome, triggers: trs.map((t: any) => t.code).join(",") || "—", note });
  }

  console.table(rows);
  const notClean = rows.filter((r) => !(r.outcome === "ESCALATED" && r.triggers === "MATCH-LOW"));
  const byVendor: Record<string, number> = {};
  for (const r of rows) byVendor[r.vendor] = (byVendor[r.vendor] ?? 0) + 1;
  console.log(`${rows.length} fake-vendor ${CATEGORY} requests — sets:`, byVendor);
  console.log(notClean.length === 0
    ? "all escalate on MATCH-LOW only -- an allow rule on the vendor name flips them"
    : `WARNING not MATCH-LOW-only: ${notClean.map((r) => `${r.vendor}/${r.amount}->${r.outcome}:${r.triggers}`).join(" | ")}`);
  console.log(`\nallow_within_limit predicate to flip a set:  { "field": "request.vendorNameRaw", "op": "eq", "value": "${VENDORS[0]}" }`);
}
main().catch((e) => { console.error(e); process.exit(1); });
