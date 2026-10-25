// Builds the guided-demo database. Refuses to touch any file that is not demo-build.db.
// Seed and process the base world, pay the ready queue in MOCK, then leave seven NEW requests
// with a real Claude read on each document. Vacuum the result into data/demo-snapshot.db.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnv } from "./env";
import { REQUIRED_FIELDS, type Category, type Extracted } from "../src/db/types";
import { daysBetween } from "../src/lib/engine/util";
import { normalizeVendor, similarity } from "../src/lib/engine/match";

const TODAY = "2026-10-24";
const ACT1_NOTE = "Client paid the PG&E bill on Oct 18 and asks to be reimbursed.";
const ACT1_TEXT = "PG&E PAYMENT CONFIRMATION\nAccount ****4471\nPayment date: 2026-10-18\nLine item: Electric service — $50.00\nAmount paid: $50.00";
const mintText = (n: number) => `MINT MOBILE\nAgency family plan (5 lines)\nLine ${n} of 5 — Unlimited — $30.00\nAmount due: $30.00\nThis document is only this one line. Total due: $30.00`;

function hash(text: string) {
  return createHash("sha256").update(Buffer.from(text)).digest("hex");
}

function resembles(descriptor: string, names: string[]) {
  return names.some((n) => similarity(descriptor, n) >= 0.5);
}

function dropCachedRead(text: string) {
  const needle = text.match(/Line \d of 5/)?.[0] ?? "PG&E PAYMENT CONFIRMATION";
  const dir = path.join("data", "cache");
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const p = path.join(dir, file);
    if (fs.readFileSync(p, "utf8").includes(needle)) fs.unlinkSync(p);
  }
}

async function main() {
  loadEnv();
  const dbPath = process.env.DATABASE_PATH ?? "";
  if (!dbPath.endsWith("demo-build.db")) {
    console.error(`refusing to run: DATABASE_PATH must end with demo-build.db (got ${dbPath || "(unset)"})`);
    process.exit(1);
  }
  for (const p of [dbPath, `${dbPath}-journal`, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const { generate } = await import("./generate");
  const { loadSeed } = await import("./seed");
  const seed = generate();
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync("data/seed.json", JSON.stringify(seed, null, 2));
  loadSeed(seed, dbPath);
  console.log(`seeded ${dbPath}`);

  const { db, schema } = await import("../src/db/client");
  const { eq } = await import("drizzle-orm");
  const { appendAudit } = await import("../src/lib/audit");
  const { extractDocument } = await import("../src/lib/llm/extract");
  const { adapters } = await import("../src/lib/adapters");
  const { attestItem, certifyBatch, openBatch, processAllPending, releaseBatch } = await import("../src/lib/pipeline");
  const { generateReports } = await import("../src/lib/reports");

  const processed = await processAllPending();
  generateReports();
  console.log(`processed ${processed.length} base requests`);

  const savedMode = process.env.MODE;
  process.env.MODE = "MOCK";
  try {
    const ready = db.select({ id: schema.requests.id }).from(schema.requests).where(eq(schema.requests.status, "READY")).all();
    if (ready.length) {
      const batchId = openBatch("program.supervisor");
      const batch = db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.id, batchId)).get();
      if (!batch) throw new Error("batch missing after open");
      for (const id of batch.sampleIds) attestItem({ batchId, requestId: id, humanId: "program.supervisor" });
      certifyBatch({ batchId, humanId: "program.supervisor" });
      const sent = await releaseBatch({ batchId, humanId: "finance.director" });
      console.log(`cleared ready queue: batch ${batchId}, released ${sent}`);
    }
  } finally {
    if (savedMode === undefined) delete process.env.MODE;
    else process.env.MODE = savedMode;
  }

  let pge = db.select().from(schema.vendors).all().find((v) => /pacific gas/i.test(v.legalName) || v.aliases.some((a) => /^(pg&e|pge)$/i.test(a)));
  if (!pge) {
    const row = { id: "v_pge_demo", legalName: "Pacific Gas and Electric Company", normalizedName: normalizeVendor("Pacific Gas and Electric Company"), aliases: ["PG&E"], category: "utilities" as const, crsTestIdentityId: null, crsStatus: "VERIFIED" as const, nessieAccountId: null };
    db.insert(schema.vendors).values(row).run();
    pge = row;
    console.log("added vendor Pacific Gas and Electric Company");
  }

  const names = [pge.legalName, ...pge.aliases];
  const local = db.select().from(schema.bankTransactions).all().filter((b) => Math.abs(b.amountCents - 5000) <= Math.max(1, 5000 * 0.02) && daysBetween(b.postedAt, TODAY) <= 60 && (resembles(b.descriptor, names) || resembles(b.counterpartyNormalized, names)));
  if (local.length) {
    console.error("a seeded posting within ±2% of $50 resembles PG&E:", local);
    process.exit(1);
  }
  const live = await adapters().bank.listPostings({ sinceDays: 60, today: TODAY });
  const liveHit = live.filter((b) => Math.abs(b.amountCents - 5000) <= Math.max(1, 5000 * 0.02) && daysBetween(b.postedAt, TODAY) <= 60 && resembles(b.descriptor, names));
  if (liveHit.length) {
    console.error("the bank feed has a posting within ±2% of $50 resembling PG&E, so BANK-LOW would not fire:", liveHit);
    process.exit(1);
  }

  const clients = db.select().from(schema.clients).orderBy(schema.clients.id).all().slice(0, 7);
  if (clients.length < 7) { console.error("need 7 clients"); process.exit(1); }
  const [actClient, ...mintClients] = clients;
  const line1 = mintText(1);
  const docs: { id: string; requestId: string; category: Category; text: string }[] = [
    { id: "doc_act1", requestId: "req_act1", category: "utilities", text: ACT1_TEXT },
    ...[1, 2, 3, 4, 5].map((n) => ({ id: `doc_mint_${n}`, requestId: `req_mint_${n}`, category: "phone" as const, text: mintText(n) })),
    { id: "doc_mint_reused", requestId: "req_mint_reused", category: "phone", text: line1 },
  ];
  // The copy is line 1, the receipt a person approves and that is never reprocessed. A copy of line 2 would make line 2 itself an identical-document hit once the copy exists.
  if (docs[1].text !== docs[6].text) { console.error("line 1 and the sixth receipt are not byte-identical"); process.exit(1); }

  const insertReq = (id: string, clientId: string, caseManagerId: string, category: Category, cents: number, vendorId: string | null, vendorName: string, note: string) => {
    db.insert(schema.requests).values({ id, clientId, caseManagerId, category, requestedCents: cents, vendorId, vendorNameRaw: vendorName, caseNote: note, requestedAt: TODAY, status: "NEW", plantedAnomaly: null }).run();
    appendAudit({ type: "REQUEST_CREATED", actor: `human:${caseManagerId}`, requestId: id, payload: { category, requestedCents: cents, vendorNameRaw: vendorName, demo: true } });
  };
  insertReq("req_act1", actClient.id, actClient.caseManagerId, "utilities", 5000, pge.id, pge.legalName, ACT1_NOTE);
  // Typed name is the plan, not a vendor on file. "Mint Mobile" itself is a real company whose registry name the matcher would pin on every vendor.
  [1, 2, 3, 4, 5].forEach((n, i) => insertReq(`req_mint_${n}`, mintClients[i].id, mintClients[i].caseManagerId, "phone", 3000, null, "Agency family plan", `Mint Mobile family plan, line ${n} of 5.`));
  insertReq("req_mint_reused", mintClients[5].id, mintClients[5].caseManagerId, "phone", 3000, null, "Agency family plan", "Mint Mobile family plan, line 1 of 5.");
  for (const d of docs) {
    db.insert(schema.documents).values({ id: d.id, requestId: d.requestId, kind: "receipt", sourceHash: hash(d.text), rawText: d.text, imagePath: null }).run();
  }

  const modeForExtract = process.env.MODE;
  process.env.MODE = "LIVE";
  try {
    for (const d of docs) {
      const hint = { category: d.category, vendorNameRaw: d.category === "utilities" ? "PG&E" : "Mint Mobile" };
      let extracted: Extracted | null = null;
      let model = "";
      for (let attempt = 1; attempt <= 4; attempt++) {
        const result = await extractDocument({ rawText: d.text, hint });
        extracted = result.extracted;
        model = result.model;
        if (!extracted) { console.error(`${d.requestId} extraction failed: ${result.reason ?? model}`); process.exit(1); }
        const low = REQUIRED_FIELDS[d.category].find((field) => {
          const got = extracted![field] as { confidence?: number } | undefined;
          return !got || typeof got.confidence !== "number" || got.confidence < 0.8;
        });
        if (!low && extracted.amountCents?.value === (d.category === "utilities" ? 5000 : 3000)) break;
        console.error(`${d.requestId} attempt ${attempt} ${low ?? "amount"}`, JSON.stringify(extracted));
        dropCachedRead(d.text);
        extracted = null;
      }
      if (!extracted) { console.error(`${d.requestId} never cleared 0.8`); process.exit(1); }
      const amount = extracted.amountCents?.value;
      const want = d.category === "utilities" ? 5000 : 3000;
      if (amount !== want) { console.error(`${d.requestId} amountCents ${amount} (need ${want})`); process.exit(1); }
      db.update(schema.documents).set({ extracted, extractedAt: new Date().toISOString(), model }).where(eq(schema.documents.id, d.id)).run();
      console.log(`${d.requestId} read by ${model}`);
    }
  } finally {
    if (modeForExtract === undefined) delete process.env.MODE;
    else process.env.MODE = modeForExtract;
  }

  const stillNew = ["req_act1", "req_mint_1", "req_mint_2", "req_mint_3", "req_mint_4", "req_mint_5", "req_mint_reused"].filter((id) => db.select().from(schema.requests).where(eq(schema.requests.id, id)).get()?.status !== "NEW");
  if (stillNew.length) { console.error("scenario requests were decided:", stillNew); process.exit(1); }

  const scenario = { act1: "req_act1", mint: ["req_mint_1", "req_mint_2", "req_mint_3", "req_mint_4", "req_mint_5"], reused: "req_mint_reused" };
  fs.writeFileSync("data/demo-scenario.json", JSON.stringify(scenario, null, 2) + "\n");

  const dest = path.resolve("data/demo-snapshot.db");
  for (const p of [dest, `${dest}-journal`, `${dest}-wal`, `${dest}-shm`]) if (fs.existsSync(p)) fs.unlinkSync(p);
  db.$client.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  console.log(`wrote ${dest} and data/demo-scenario.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
