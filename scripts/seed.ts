// Resets the database and loads data/seed.json. Run: npm run seed
// Creates tables directly (no migration step needed for the hackathon).
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { generate, type Seed } from "./generate";

const DB_PATH = process.env.DATABASE_PATH ?? "./data/signet.db";

const DDL = `
CREATE TABLE IF NOT EXISTS case_managers (id TEXT PRIMARY KEY, name TEXT NOT NULL, unit TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (id TEXT PRIMARY KEY, display_name TEXT NOT NULL, dob TEXT NOT NULL, programs TEXT NOT NULL, case_manager_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grant_streams (id TEXT PRIMARY KEY, name TEXT NOT NULL, funder TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, total_cents INTEGER NOT NULL, spent_cents INTEGER NOT NULL DEFAULT 0, allowed_categories TEXT NOT NULL, prohibited_items TEXT NOT NULL, per_instance_cap_cents INTEGER NOT NULL, per_client_period_cap_cents INTEGER NOT NULL, eligibility TEXT NOT NULL, priority INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS vendors (id TEXT PRIMARY KEY, legal_name TEXT NOT NULL, normalized_name TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]', category TEXT NOT NULL, crs_test_identity_id TEXT, crs_status TEXT NOT NULL DEFAULT 'UNKNOWN', nessie_account_id TEXT);
CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, client_id TEXT NOT NULL, case_manager_id TEXT NOT NULL, category TEXT NOT NULL, requested_cents INTEGER NOT NULL, vendor_id TEXT, vendor_name_raw TEXT NOT NULL, case_note TEXT NOT NULL, requested_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'NEW', planted_anomaly TEXT);
CREATE INDEX IF NOT EXISTS req_client ON requests(client_id);
CREATE INDEX IF NOT EXISTS req_status ON requests(status);
CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, kind TEXT NOT NULL, source_hash TEXT NOT NULL, raw_text TEXT, image_path TEXT, extracted TEXT, extracted_at TEXT, model TEXT);
CREATE INDEX IF NOT EXISTS doc_request ON documents(request_id);
CREATE INDEX IF NOT EXISTS doc_hash ON documents(source_hash);
CREATE TABLE IF NOT EXISTS bank_transactions (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, posted_at TEXT NOT NULL, amount_cents INTEGER NOT NULL, descriptor TEXT NOT NULL, counterparty_normalized TEXT NOT NULL, source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, outcome TEXT NOT NULL, decided_by TEXT NOT NULL, human_id TEXT, rationale TEXT, triggers TEXT NOT NULL, allocation TEXT NOT NULL, limits_applied TEXT NOT NULL, policy_result TEXT NOT NULL, match_result TEXT NOT NULL, case_summary TEXT, seal TEXT NOT NULL, decided_at TEXT NOT NULL, decision_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, request_id TEXT, type TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS rule_proposals (id TEXT PRIMARY KEY, source_decision_id TEXT NOT NULL, rationale TEXT NOT NULL, predicate TEXT NOT NULL, action TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PROPOSED', replay_impact TEXT, created_at TEXT NOT NULL, activated_at TEXT, activated_by TEXT);
CREATE TABLE IF NOT EXISTS compliance_reports (id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, rows TEXT NOT NULL, totals TEXT NOT NULL, generated_at TEXT NOT NULL);
`;

export function loadSeed(seed: Seed, dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const f of [dbPath, dbPath + "-wal", dbPath + "-shm", dbPath + "-journal"]) if (fs.existsSync(f)) fs.rmSync(f);
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(DDL);
  const j = (x: unknown) => JSON.stringify(x);
  const tx = db.transaction(() => {
    const cm = db.prepare("INSERT INTO case_managers VALUES (?,?,?)");
    for (const c of seed.caseManagers) cm.run(c.id, c.name, c.unit);
    const cl = db.prepare("INSERT INTO clients VALUES (?,?,?,?,?)");
    for (const c of seed.clients) cl.run(c.id, c.displayName, c.dob, j(c.programs), c.caseManagerId);
    const g = db.prepare("INSERT INTO grant_streams VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const x of seed.grants) g.run(x.id, x.name, x.funder, x.periodStart, x.periodEnd, x.totalCents, x.spentCents, j(x.allowedCategories), j(x.prohibitedItems), x.perInstanceCapCents, x.perClientPeriodCapCents, j(x.eligibility), x.priority, x.active ? 1 : 0);
    const v = db.prepare("INSERT INTO vendors VALUES (?,?,?,?,?,?,?,?)");
    for (const x of seed.vendors) v.run(x.id, x.legalName, x.normalizedName, j(x.aliases), x.category, x.crsTestIdentityId, x.crsStatus, x.nessieAccountId);
    const b = db.prepare("INSERT INTO bank_transactions VALUES (?,?,?,?,?,?,?)");
    for (const x of seed.bank) b.run(x.id, x.accountId, x.postedAt, x.amountCents, x.descriptor, x.counterpartyNormalized, x.source);
    const rq = db.prepare("INSERT INTO requests VALUES (?,?,?,?,?,?,?,?,?,?,?)");
    const dc = db.prepare("INSERT INTO documents VALUES (?,?,?,?,?,?,?,?,?)");
    for (const q of seed.requests) {
      rq.run(q.id, q.clientId, q.caseManagerId, q.category, q.requestedCents, q.vendorId, q.vendorNameRaw, q.caseNote, q.requestedAt, "NEW", q.plantedAnomaly);
      for (const d of q.documents) dc.run(d.id, q.id, d.kind, d.sourceHash, d.rawText, d.imagePath, null, null, null);
    }
  });
  tx();
  db.close();
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  const seed = generate();
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/seed.json", JSON.stringify(seed, null, 2));
  loadSeed(seed);
  console.log(`seeded ${DB_PATH}: ${seed.requests.length} requests, ${seed.bank.length} bank postings, ${seed.grants.length} grants, ${seed.vendors.length} vendors, ${seed.clients.length} clients`);
  if (process.argv.includes("--nessie")) console.log("(--nessie: push to Capital One Nessie happens in src/lib/adapters/nessie.ts once that adapter exists)");
}
