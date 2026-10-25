// The only orchestrator. Route handlers call these; no logic lives in routes.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db/client";
import type { Decision, Request, RuleProposal } from "@/db/schema";
import { DEFAULT_LIMITS, DUAL_CONTROL_CENTS, SAMPLE_MIN, SAMPLE_RATE, type Category, type Extracted, type Outcome, type TriggerCode } from "@/db/types";
import { runChecks } from "@/lib/engine/run";
import type { HistoryItem } from "@/lib/engine/policy";
import { normalizeVendor } from "@/lib/engine/match";
import { applyClaudeDraft, proposeRule, replay, validatePredicate, type ReplayItem, type RuleCtx } from "@/lib/engine/rules";
import { adapters, currentMode } from "@/lib/adapters";
import { extractDocument, heuristicExtractor, truthExtractor } from "@/lib/llm/extract";
import { writeSummary, writeDefense, writeExplanation } from "@/lib/llm/write";
import { draftRuleWithClaude } from "@/lib/llm/draftRule";
import { appendAudit } from "@/lib/audit";
import { vendorPublicRecord, rentBenchmark } from "@/lib/adapters/public";
import { memory, memoryStats, decisionDoc, policyDocs, vendorDoc, type MemHit } from "@/lib/adapters/memory";
import { corpusDocs } from "@/lib/corpus";
import { TRIGGER } from "@/lib/labels";

export const TODAY = () => process.env.DEMO_TODAY ?? "2026-10-24";
const sealHash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// ---------- seed truth (MOCK/OFFLINE extractor for seeded requests) ----------
type SeedFile = { requests: { id: string; truth: Parameters<typeof truthExtractor>[0]; documents: { rawText: string | null }[] }[] };
let seedCache: SeedFile | null = null;
function seedTruth(requestId: string) {
  try { seedCache ??= JSON.parse(fs.readFileSync("data/seed.json", "utf8")) as SeedFile; } catch { return null; }
  return seedCache.requests.find((r) => r.id === requestId) ?? null;
}

// ---------- history view for the engines ----------
function historyFor(excludeRequestId: string): HistoryItem[] {
  const rows = db.select({ d: schema.decisions, r: schema.requests, c: schema.clients })
    .from(schema.decisions)
    .innerJoin(schema.requests, eq(schema.decisions.requestId, schema.requests.id))
    .innerJoin(schema.clients, eq(schema.requests.clientId, schema.clients.id))
    .where(ne(schema.decisions.requestId, excludeRequestId)).all();
  const docs = db.select({ requestId: schema.documents.requestId, hash: schema.documents.sourceHash }).from(schema.documents).all();
  const hashes = new Map<string, string[]>();
  for (const d of docs) hashes.set(d.requestId, [...(hashes.get(d.requestId) ?? []), d.hash]);
  return rows.map(({ d, r, c }) => ({
    requestId: r.id, clientId: r.clientId, clientDisplayName: c.displayName, vendorNormalized: normalizeVendor(r.vendorNameRaw),
    requestedCents: r.requestedCents, requestedAt: r.requestedAt, documentHashes: hashes.get(r.id) ?? [], allocation: d.allocation, outcome: d.outcome,
  }));
}

function activeRules() { return db.select().from(schema.ruleProposals).where(eq(schema.ruleProposals.status, "ACTIVE")).all(); }

// ---------- 1. process one request through the whole function ----------
export async function processRequest(requestId: string, opts: { reprocess?: boolean } = {}) {
  const t0 = Date.now();
  const req = db.select().from(schema.requests).where(eq(schema.requests.id, requestId)).get();
  if (!req) throw new Error("request not found");
  const existing = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, requestId)).get();
  if (existing && !opts.reprocess) return existing;
  if (existing && opts.reprocess) db.delete(schema.decisions).where(eq(schema.decisions.requestId, requestId)).run();

  const client = db.select().from(schema.clients).where(eq(schema.clients.id, req.clientId)).get()!;
  const docs = db.select().from(schema.documents).where(eq(schema.documents.requestId, requestId)).all();
  const grants = db.select().from(schema.grantStreams).all();
  const vendors = db.select().from(schema.vendors).all();
  const { mode, bank, vendorCheck } = adapters();
  db.update(schema.requests).set({ status: "PROCESSING" }).where(eq(schema.requests.id, requestId)).run();

  // --- document reading (the one LLM role) ---
  let extracted: Extracted | null = null;
  let model = "none";
  const seeded = seedTruth(requestId);
  for (const doc of docs) {
    if (doc.extracted) { extracted = doc.extracted; model = doc.model ?? model; continue; }
    let result: { extracted: Extracted | null; model: string; reason?: string };
    if (mode === "LIVE" || doc.imagePath) {
      result = await extractDocument({ rawText: doc.rawText, imagePath: doc.imagePath, hint: { category: req.category, vendorNameRaw: req.vendorNameRaw } });
      if (!result.extracted && seeded) result = { extracted: truthExtractor(seeded.truth, noiseOf(doc.rawText)), model: "truth-extractor" };
      if (!result.extracted) result = { extracted: heuristicExtractor(doc.rawText ?? "", req.vendorNameRaw), model: "heuristic" };
    } else if (seeded) {
      result = { extracted: truthExtractor(seeded.truth, noiseOf(doc.rawText)), model: "truth-extractor" };
    } else {
      // a new request typed at the table in MOCK/OFFLINE: try the cache first (OFFLINE), else heuristics
      result = await extractDocument({ rawText: doc.rawText, imagePath: doc.imagePath, hint: { category: req.category, vendorNameRaw: req.vendorNameRaw } });
      if (!result.extracted) result = { extracted: heuristicExtractor(doc.rawText ?? "", req.vendorNameRaw), model: "heuristic" };
    }
    extracted = result.extracted; model = result.model;
    db.update(schema.documents).set({ extracted: result.extracted, extractedAt: new Date().toISOString(), model: result.model }).where(eq(schema.documents.id, doc.id)).run();
    appendAudit({ type: "DOC_EXTRACTED", actor: `agent:${result.model}`, requestId, payload: { documentId: doc.id, fields: Object.keys(result.extracted ?? {}), reason: result.reason ?? null } });
  }

  // --- adapters: bank postings + vendor check ---
  const postings = await bank.listPostings({ sinceDays: 60, today: TODAY() });
  const vendorGuess = vendors.find((v) => v.id === req.vendorId) ?? null;
  const crs = vendorGuess ? await vendorCheck.verifyVendor({ vendorId: vendorGuess.id, legalName: vendorGuess.legalName, crsTestIdentityId: vendorGuess.crsTestIdentityId, knownStatus: vendorGuess.crsStatus }) : null;

  // --- public web evidence (Bright Data; cached; never blocks on failure) ---
  const vendorNameForRecord = vendorGuess?.legalName ?? extracted?.vendorName?.value ?? req.vendorNameRaw;
  const pub = await vendorPublicRecord(vendorNameForRecord).catch((e) => { if ((e as Error).message === "The demo is busy, try again in a minute") throw e; return null; });
  const publicRecord = pub && (pub.sfBusiness || pub.web)
    ? { sfRegistered: pub.sfBusiness ? pub.sfBusiness.found : null, dbaNames: pub.sfBusiness?.dbaNames ?? [], webPresence: pub.web ? pub.web.found : null, source: pub.source === "CACHE" ? "cached public record" : pub.sfBusiness?.source ?? pub.web?.source ?? pub.source }
    : null;
  const fmr = req.category === "rent" ? await rentBenchmark().catch(() => null) : null;
  const rent = fmr ? { fmr1brCents: fmr.fmrCents["1br"], source: fmr.source } : null;

  // --- the two engines + decision ---
  const run = runChecks({
    request: req, client, extracted, documentHashes: docs.map((d) => d.sourceHash), grants, vendors, bank: postings, crs, publicRecord, rent,
    history: historyFor(requestId), activeRules: activeRules(), limits: DEFAULT_LIMITS, today: TODAY(),
  });
  appendAudit({ type: "CHECKS_RUN", actor: "system", requestId, payload: { policy: run.policy.triggers.map((t) => t.code), match: run.matchRes.triggers.map((t) => t.code), allocation: run.policy.allocation } });

  // --- summary (descriptive only) ---
  const caseSummary = await writeSummary({ category: req.category, requestedCents: req.requestedCents, vendorNameRaw: req.vendorNameRaw, caseNote: req.caseNote, extractedSummary: describe(extracted), triggers: run.decision.triggers, allocation: run.decision.allocation });

  const decidedAt = new Date().toISOString();
  const outcome: Outcome = run.decision.outcome;
  const seal = { kind: "SYSTEM" as const, at: decidedAt, by: "signet", hash: sealHash(requestId + decidedAt + outcome) };
  const decisionId = nanoid(10);
  db.insert(schema.decisions).values({
    id: decisionId, requestId, outcome, decidedBy: "SYSTEM", triggers: run.decision.triggers, allocation: run.decision.allocation, limitsApplied: run.decision.limitsApplied,
    policyResult: run.policy as object, matchResult: run.matchRes as object, caseSummary, seal, decidedAt, decisionMs: Date.now() - t0,
  }).run();

  await ensureMemory();
  memory().add([decisionDoc({ requestId, category: req.category, requestedCents: req.requestedCents, vendorNameRaw: req.vendorNameRaw, caseNote: req.caseNote, outcome, decidedBy: "SYSTEM", triggers: run.decision.triggers })]).catch(() => {});

  if (outcome === "READY") {
    // Verified and batch-eligible. Nothing is approved and no money moves until a named person certifies and another releases.
    db.update(schema.requests).set({ status: "READY", vendorId: run.matchRes.vendorId ?? req.vendorId }).where(eq(schema.requests.id, requestId)).run();
    appendAudit({ type: "VERIFIED_READY", actor: "system", requestId, payload: { allocation: run.decision.allocation, limit: run.decision.limitsApplied, seal } });
  } else {
    db.update(schema.requests).set({ status: "ESCALATED", vendorId: run.matchRes.vendorId ?? req.vendorId }).where(eq(schema.requests.id, requestId)).run();
    appendAudit({ type: "ESCALATED", actor: "system", requestId, payload: { triggers: run.decision.triggers.map((t) => ({ code: t.code, reason: t.reason })) } });
  }
  return db.select().from(schema.decisions).where(eq(schema.decisions.requestId, requestId)).get()!;
}

// Money moves only here, and only from releaseBatch(), on a batch a different person certified.
async function disburse(req: Request, allocation: { grantId: string; cents: number }[], vendorName: string, actor: string, batchId: string) {
  const { bank } = adapters();
  const txns: { grantId: string; cents: number; txnId: string; accountId?: string; raw?: unknown }[] = [];
  for (const a of allocation) {
    const t = await bank.transfer({ vendorId: req.vendorId ?? "", vendorName, amountCents: a.cents, memo: `${a.grantId} ${req.id}` });
    txns.push({ ...a, txnId: t.txnId, accountId: t.accountId, raw: t.raw });
    const g = db.select().from(schema.grantStreams).where(eq(schema.grantStreams.id, a.grantId)).get();
    if (g) db.update(schema.grantStreams).set({ spentCents: g.spentCents + a.cents }).where(eq(schema.grantStreams.id, a.grantId)).run();
  }
  db.update(schema.requests).set({ status: "RELEASED" }).where(eq(schema.requests.id, req.id)).run();
  appendAudit({ type: "PAYMENT_SENT", actor, requestId: req.id, payload: { txns, source: bank.source, batchId } });
}

// ---------- 2. human decision on an escalation (the only path to DENIED; APPROVED here still waits for release) ----------
export async function humanDecide(args: { requestId: string; humanId: string; outcome: "APPROVED" | "DENIED"; rationale: string; allocation?: { grantId: string; cents: number }[]; chosenTrigger?: TriggerCode }) {
  if (!args.rationale.trim()) throw new Error("rationale required");
  const req = db.select().from(schema.requests).where(eq(schema.requests.id, args.requestId)).get();
  const prior = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, args.requestId)).get();
  if (!req || !prior) throw new Error("request/decision not found");
  if (prior.decidedBy === "HUMAN") throw new Error("already decided by a human");
  const decidedAt = new Date().toISOString();
  const allocation = args.allocation ?? prior.allocation;
  const seal = { kind: "HUMAN" as const, at: decidedAt, by: args.humanId, hash: sealHash(args.requestId + decidedAt + args.outcome + args.humanId) };
  db.update(schema.decisions).set({ outcome: args.outcome, decidedBy: "HUMAN", humanId: args.humanId, rationale: args.rationale, allocation, seal, decidedAt }).where(eq(schema.decisions.requestId, args.requestId)).run();
  db.update(schema.requests).set({ status: args.outcome }).where(eq(schema.requests.id, args.requestId)).run(); // APPROVED = certified, awaiting release
  appendAudit({ type: "HUMAN_DECIDED", actor: `human:${args.humanId}`, requestId: args.requestId, payload: { outcome: args.outcome, rationale: args.rationale, allocation, seal } });
  await ensureMemory();
  memory().add([decisionDoc({ requestId: req.id, category: req.category, requestedCents: req.requestedCents, vendorNameRaw: req.vendorNameRaw, caseNote: req.caseNote, outcome: args.outcome, decidedBy: `HUMAN ${args.humanId}`, rationale: args.rationale, triggers: prior.triggers })]).catch(() => {});

  // propose a rule from the human's resolution
  const chosen = args.chosenTrigger ?? prior.triggers[0]?.code ?? "LIMIT-OVER";
  const lineFlags = ((db.select().from(schema.documents).where(eq(schema.documents.requestId, req.id)).get()?.extracted?.lineItems?.value) ?? []).map((l) => l.flag ?? "").filter(Boolean);
  const chosenObj = prior.triggers.find((t) => t.code === chosen);
  const draft = proposeRule({ chosenTrigger: chosen, category: req.category, vendorNameRaw: req.vendorNameRaw, lineItemFlags: lineFlags, humanOutcome: args.outcome, chosenTriggerObj: chosenObj, clientId: req.clientId });
  const sourceCtx = replayItems().find((h) => h.requestId === req.id)?.ctx;
  const claude = sourceCtx
    ? await draftRuleWithClaude({ rationale: args.rationale, category: req.category, vendorNameRaw: req.vendorNameRaw, requestedCents: req.requestedCents, triggers: prior.triggers.map((t) => ({ code: t.code, reason: t.reason })) }).catch(() => null)
    : null;
  const composed = applyClaudeDraft(draft, sourceCtx ?? ({} as RuleCtx), claude);
  const proposalId = nanoid(10);
  const impact = replayRule(composed.predicate, composed.action);
  db.insert(schema.ruleProposals).values({ id: proposalId, sourceDecisionId: prior.id, rationale: args.rationale, predicate: composed.predicate, action: composed.action, status: "PROPOSED", replayImpact: impact, createdAt: decidedAt }).run();
  appendAudit({ type: "RULE_PROPOSED", actor: "system", requestId: req.id, payload: { proposalId, title: composed.title, action: composed.action, predicate: composed.predicate, templatePredicate: composed.templatePredicate, claudePredicate: composed.claudePredicate, draftedBy: composed.draftedBy, replay: impact } });
  return { proposalId, title: composed.title };
}

// ---------- 3. rules: replay / activate / reject ----------
function replayItems(): ReplayItem[] {
  const rows = db.select({ d: schema.decisions, r: schema.requests }).from(schema.decisions).innerJoin(schema.requests, eq(schema.decisions.requestId, schema.requests.id)).all();
  return rows.map(({ d, r }) => {
    const pr = d.policyResult as { clientAgeYears?: number; allocation?: { grantId: string }[] };
    const mr = d.matchResult as { vendorConfidence?: number; bankConfidence?: number; crsStatus?: string };
    const ext = db.select().from(schema.documents).where(eq(schema.documents.requestId, r.id)).get()?.extracted;
    const ctx: RuleCtx = {
      "request.category": r.category, "request.requestedCents": r.requestedCents, "request.vendorNameRaw": r.vendorNameRaw, "request.clientAgeYears": pr.clientAgeYears ?? null,
      "extracted.lineItems.flags": (ext?.lineItems?.value ?? []).map((l) => l.flag).filter(Boolean), "extracted.amountCents": ext?.amountCents?.value ?? null,
      "match.vendorConfidence": mr.vendorConfidence ?? null, "match.bankConfidence": mr.bankConfidence ?? null, "vendor.crsStatus": mr.crsStatus ?? null,
      "vendor.normalizedName": normalizeVendor(r.vendorNameRaw), "grant.id": pr.allocation?.[0]?.grantId ?? null,
      "history.sameVendor45dCount": 0,
      "history.sameVendorAmount45dCount": 0,
    };
    // compute sameVendor count against other decided requests
    const vn = normalizeVendor(r.vendorNameRaw);
    const near = rows.filter((o) => o.r.id !== r.id && normalizeVendor(o.r.vendorNameRaw) === vn && Math.abs(new Date(o.r.requestedAt).getTime() - new Date(r.requestedAt).getTime()) <= 45 * 86400e3);
    ctx["history.sameVendor45dCount"] = near.length;
    ctx["history.sameVendorAmount45dCount"] = near.filter((o) => Math.abs(o.r.requestedCents - r.requestedCents) <= r.requestedCents * 0.01).length;
    return { requestId: r.id, ctx, decidedBy: d.decidedBy, outcome: d.outcome, triggerCodes: d.triggers.map((t) => t.code), clientId: r.clientId, triggers: d.triggers };
  });
}
export function replayRule(predicate: RuleProposal["predicate"], action: RuleProposal["action"]) { return replay({ predicate, action }, replayItems()); }

export function activateRule(args: { proposalId: string; humanId: string; predicate?: unknown }) {
  const p = db.select().from(schema.ruleProposals).where(eq(schema.ruleProposals.id, args.proposalId)).get();
  if (!p) throw new Error("proposal not found");
  const predicate = (args.predicate ?? p.predicate) as RuleProposal["predicate"];
  const err = validatePredicate(predicate);
  if (err) throw new Error(err);
  const impact = replayRule(predicate, p.action);
  const at = new Date().toISOString();
  db.update(schema.ruleProposals).set({ predicate, status: "ACTIVE", activatedAt: at, activatedBy: args.humanId, replayImpact: impact }).where(eq(schema.ruleProposals.id, args.proposalId)).run();
  appendAudit({ type: "RULE_ACTIVATED", actor: `human:${args.humanId}`, requestId: null, payload: { proposalId: p.id, action: p.action, predicate, replay: impact } });
  return impact;
}
export function rejectRule(args: { proposalId: string; humanId: string }) {
  db.update(schema.ruleProposals).set({ status: "REJECTED" }).where(eq(schema.ruleProposals.id, args.proposalId)).run();
  appendAudit({ type: "RULE_REJECTED", actor: `human:${args.humanId}`, requestId: null, payload: { proposalId: args.proposalId } });
}
export function retireRule(args: { proposalId: string; humanId: string; reason: string }) {
  if (!args.reason.trim()) throw new Error("reason required");
  const p = db.select().from(schema.ruleProposals).where(eq(schema.ruleProposals.id, args.proposalId)).get();
  if (!p) throw new Error("proposal not found");
  if (p.status !== "ACTIVE") throw new Error("only an ACTIVE rule can be retired");
  db.update(schema.ruleProposals).set({ status: "RETIRED" }).where(eq(schema.ruleProposals.id, args.proposalId)).run();
  appendAudit({ type: "RULE_RETIRED", actor: `human:${args.humanId}`, requestId: null, payload: { proposalId: args.proposalId, reason: args.reason, retiredAt: new Date().toISOString() } });
}

// ---------- 4. defense on demand ----------
export async function defend(requestId: string) {
  const d = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, requestId)).get();
  const r = db.select().from(schema.requests).where(eq(schema.requests.id, requestId)).get();
  if (!d || !r) throw new Error("not found");
  const ext = db.select().from(schema.documents).where(eq(schema.documents.requestId, requestId)).get()?.extracted ?? null;
  return writeDefense({ category: r.category, requestedCents: r.requestedCents, vendorNameRaw: r.vendorNameRaw, caseNote: r.caseNote, extractedSummary: describe(ext), triggers: d.triggers, allocation: d.allocation, outcome: d.outcome, decidedBy: d.decidedBy, rationale: d.rationale });
}

// ---------- 5. new request (judge at the table) ----------
export async function createRequest(args: { clientId: string; category: Category; requestedCents: number; vendorNameRaw: string; caseNote: string; rawText?: string; imagePath?: string }) {
  const client = db.select().from(schema.clients).where(eq(schema.clients.id, args.clientId)).get();
  if (!client) throw new Error("client not found");
  const vendors = db.select().from(schema.vendors).all();
  const vn = normalizeVendor(args.vendorNameRaw);
  const vendor = vendors.find((v) => v.normalizedName === vn || v.aliases.some((a) => normalizeVendor(a) === vn)) ?? null;
  const id = "req_" + nanoid(6);
  const requestedAt = TODAY();
  db.insert(schema.requests).values({ id, clientId: client.id, caseManagerId: client.caseManagerId, category: args.category, requestedCents: args.requestedCents, vendorId: vendor?.id ?? null, vendorNameRaw: args.vendorNameRaw, caseNote: args.caseNote, requestedAt, status: "NEW", plantedAnomaly: null }).run();
  const src = args.imagePath ? fs.readFileSync(args.imagePath) : Buffer.from(args.rawText ?? "");
  db.insert(schema.documents).values({ id: "doc_" + nanoid(6), requestId: id, kind: args.imagePath ? "photo" : "receipt", sourceHash: createHash("sha256").update(src).digest("hex"), rawText: args.rawText ?? null, imagePath: args.imagePath ?? null }).run();
  appendAudit({ type: "REQUEST_CREATED", actor: `human:${client.caseManagerId}`, requestId: id, payload: { category: args.category, requestedCents: args.requestedCents, vendorNameRaw: args.vendorNameRaw, live: true } });
  return processRequest(id);
}

// ---------- 6. process everything not yet decided (seed run) ----------
export async function processAllPending(limit = 500) {
  const pending = db.select({ id: schema.requests.id }).from(schema.requests).where(inArray(schema.requests.status, ["NEW"])).orderBy(schema.requests.requestedAt).limit(limit).all();
  const out: Decision[] = [];
  for (const p of pending) out.push(await processRequest(p.id));
  return out;
}

// ---------- 2b. release batches: open → attest sample → certify (Approver) → release (Releaser, a different person) ----------
function batchable() {
  return db.select({ r: schema.requests, d: schema.decisions }).from(schema.requests)
    .innerJoin(schema.decisions, eq(schema.decisions.requestId, schema.requests.id))
    .where(and(inArray(schema.requests.status, ["READY", "APPROVED"]), isNull(schema.decisions.batchId)))
    .orderBy(schema.requests.requestedAt).all();
}
export function openBatchPreview() {
  const items = batchable();
  return { count: items.length, totalCents: items.reduce((s, x) => s + x.r.requestedCents, 0), dualControl: items.filter((x) => x.r.requestedCents >= DUAL_CONTROL_CENTS).length };
}
// deterministic sample: seeded by batch id so the audit log can reproduce it
function pickSample(ids: string[], seed: string, n: number) {
  let h = 2166136261; for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const rnd = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 2 ** 32; };
  const pool = [...ids]; const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return out;
}
export function openBatch(humanId: string) {
  const items = batchable();
  if (!items.length) throw new Error("nothing is ready for a batch");
  const id = "batch_" + nanoid(6);
  const at = new Date().toISOString();
  const mustOpen = items.filter((x) => x.d.decidedBy === "SYSTEM" && x.r.requestedCents >= DUAL_CONTROL_CENTS).map((x) => x.r.id);
  const systemOnly = items.filter((x) => x.d.decidedBy === "SYSTEM" && !mustOpen.includes(x.r.id)).map((x) => x.r.id);
  const n = Math.min(systemOnly.length, Math.max(SAMPLE_MIN, Math.ceil(systemOnly.length * SAMPLE_RATE)));
  const sampleIds = [...mustOpen, ...pickSample(systemOnly, id, n)];
  const itemIds = items.map((x) => x.r.id);
  const totalCents = items.reduce((s, x) => s + x.r.requestedCents, 0);
  db.insert(schema.releaseBatches).values({ id, status: "OPEN", itemIds, sampleIds, attestedIds: [], totalCents, openedBy: humanId, openedAt: at }).run();
  db.update(schema.decisions).set({ batchId: id }).where(inArray(schema.decisions.requestId, itemIds)).run();
  appendAudit({ type: "BATCH_OPENED", actor: `human:${humanId}`, requestId: null, payload: { batchId: id, items: itemIds.length, totalCents, sample: sampleIds, sampleRule: `${SAMPLE_MIN} min or ${Math.round(SAMPLE_RATE * 100)}% of system-verified items + every item ≥ $${DUAL_CONTROL_CENTS / 100}` } });
  return id;
}
export function attestItem(args: { batchId: string; requestId: string; humanId: string }) {
  const b = db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.id, args.batchId)).get();
  if (!b || b.status !== "OPEN") throw new Error("batch not open");
  if (!b.itemIds.includes(args.requestId)) throw new Error("item not in batch");
  if (b.attestedIds.includes(args.requestId)) return;
  const attestedIds = [...b.attestedIds, args.requestId];
  db.update(schema.releaseBatches).set({ attestedIds }).where(eq(schema.releaseBatches.id, b.id)).run();
  appendAudit({ type: "ITEM_ATTESTED", actor: `human:${args.humanId}`, requestId: args.requestId, payload: { batchId: b.id, statement: "I opened this record, read the document and the checks, and certify the facts recited." } });
}
export function certifyBatch(args: { batchId: string; humanId: string }) {
  const b = db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.id, args.batchId)).get();
  if (!b || b.status !== "OPEN") throw new Error("batch not open");
  const missing = b.sampleIds.filter((id) => !b.attestedIds.includes(id));
  if (missing.length) throw new Error(`open and attest ${missing.length} more sampled item${missing.length === 1 ? "" : "s"} first`);
  const at = new Date().toISOString();
  db.transaction((tx) => { // all-or-nothing: a batch is never half certified
  for (const requestId of b.itemIds) {
    const d = tx.select().from(schema.decisions).where(eq(schema.decisions.requestId, requestId)).get();
    if (!d || d.decidedBy === "HUMAN") continue; // already certified individually
    const seal = { kind: "HUMAN" as const, at, by: args.humanId, hash: sealHash(requestId + at + "APPROVED" + args.humanId + b.id) };
    tx.update(schema.decisions).set({ outcome: "APPROVED", decidedBy: "HUMAN", humanId: args.humanId, rationale: `Certified in batch ${b.id}${b.attestedIds.includes(requestId) ? " (sampled and opened)" : ""}.`, seal, decidedAt: at }).where(eq(schema.decisions.requestId, requestId)).run();
    tx.update(schema.requests).set({ status: "APPROVED" }).where(eq(schema.requests.id, requestId)).run();
  }
  tx.update(schema.releaseBatches).set({ status: "CERTIFIED", certifiedBy: args.humanId, certifiedAt: at }).where(eq(schema.releaseBatches.id, b.id)).run();
  });
  appendAudit({ type: "BATCH_CERTIFIED", actor: `human:${args.humanId}`, requestId: null, payload: { batchId: b.id, items: b.itemIds.length, totalCents: b.totalCents, sampleAttested: b.attestedIds, statement: "I certify that the items in this batch are proper for payment under the funding rules shown." } });
}
export async function releaseBatch(args: { batchId: string; humanId: string }) {
  const b = db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.id, args.batchId)).get();
  if (!b || b.status !== "CERTIFIED") throw new Error("batch is not certified");
  if (b.certifiedBy === args.humanId) throw new Error("the person who certified a batch cannot release it (segregation of duties)");
  const at = new Date().toISOString();
  let sent = 0;
  for (const requestId of b.itemIds) {
    const req = db.select().from(schema.requests).where(eq(schema.requests.id, requestId)).get();
    const d = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, requestId)).get();
    if (!req || !d || req.status !== "APPROVED") continue;
    const vendor = db.select().from(schema.vendors).where(eq(schema.vendors.id, req.vendorId ?? "")).get();
    await disburse(req, d.allocation, vendor?.legalName ?? req.vendorNameRaw, `human:${args.humanId}`, b.id);
    sent++;
  }
  db.update(schema.releaseBatches).set({ status: "RELEASED", releasedBy: args.humanId, releasedAt: at }).where(eq(schema.releaseBatches.id, b.id)).run();
  appendAudit({ type: "BATCH_RELEASED", actor: `human:${args.humanId}`, requestId: null, payload: { batchId: b.id, sent, totalCents: b.totalCents, certifiedBy: b.certifiedBy } });
  return sent;
}

// prefer memory hits that were written about the same flags (metadata.codes), then by similarity
function rankByCodes(hits: MemHit[], codes: string[]) {
  const score = (h: MemHit) => (h.metadata?.codes ?? "").split(",").filter((c) => c && codes.includes(c)).length;
  return [...hits].sort((a, b) => score(b) - score(a) || b.score - a.score);
}

// ---------- 4b. explain a record to a non-technical reviewer ----------
// Deterministic: each flag → what it means, what we saw, where the rule comes from, how a supervisor handled it before,
// what to look at. Claude may add one plain-English paragraph on top when available; the structure never depends on it.
export type Explanation = {
  headline: string;
  flags: { code: string; title: string; means: string; saw: string; rule: { cite: string; text: string } | null; precedent: { text: string; outcome: string } | null; look: string }[];
  clean: string[];
  summary: string | null;
  memorySource: string;
  memoryError: string;
};
export async function explain(requestId: string): Promise<Explanation> {
  const r = db.select().from(schema.requests).where(eq(schema.requests.id, requestId)).get();
  const d = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, requestId)).get();
  if (!r || !d) throw new Error("not found");
  await ensureMemory();
  const m = memory();
  const mr = d.matchResult as { vendorLegalName?: string | null; vendorConfidence?: number; bankConfidence?: number; crsStatus?: string; docVendorName?: string };
  const pr = d.policyResult as { eligibleGrants?: string[]; clientAgeYears?: number };
  const flags: Explanation["flags"] = [];
  for (const t of d.triggers) {
    const meta = TRIGGER[t.code];
    const [rules, hist] = await Promise.all([
      m.query("policy", `${meta?.title ?? t.code}. ${t.reason}`, 6).then((h) => rankByCodes(h, [t.code])[0] ?? null),
      m.query("decision", `${meta?.title ?? t.code}. ${r.category} ${r.vendorNameRaw}. ${t.reason}`, 8).then((h) => rankByCodes(h.filter((x) => x.id !== requestId && x.metadata?.decidedBy?.startsWith("HUMAN")), [t.code])[0] ?? null),
    ]);
    flags.push({
      code: t.code, title: meta?.title ?? t.code, means: meta?.means ?? "", saw: t.reason,
      rule: rules ? { cite: rules.metadata?.source === "regulation" ? rules.metadata.grant ?? "" : rules.metadata?.source === "manual" ? `Procedures manual ${rules.metadata.grant}` : `Grant ${rules.metadata?.grant ?? ""} terms`, text: rules.text.replace(/^(Procedures manual §[\d.]+ [^.]+\. |\S+ CFR [^ ]+ [^.]+\. )/, "") } : null,
      precedent: hist ? { text: hist.text.replace(/^.*?Outcome (APPROVED|DENIED) by [^:]+: /, ""), outcome: hist.metadata?.outcome ?? "" } : null,
      look: meta?.look ?? "",
    });
  }
  if (!d.triggers.length) await m.query("policy", `${r.category} ${r.vendorNameRaw}`, 1);
  const clean: string[] = [];
  if (pr.eligibleGrants?.length) clean.push(`Eligible under ${pr.eligibleGrants.join(", ")}${pr.clientAgeYears ? ` (client is ${pr.clientAgeYears})` : ""}.`);
  if (d.allocation.length) clean.push(`Funding: ${d.allocation.map((a) => `${a.grantId} $${(a.cents / 100).toFixed(2)}`).join(" + ")}, within caps.`);
  if (mr.vendorLegalName && (mr.vendorConfidence ?? 0) >= 0.9) clean.push(`Payee matches ${mr.vendorLegalName} on the vendor list.`);
  if ((mr.bankConfidence ?? 0) >= 0.9) clean.push("A matching payment is in the bank feed.");
  if (mr.crsStatus === "VERIFIED") clean.push("Vendor identity check passed.");
  if (!d.triggers.some((t) => t.code === "DUP-HIT")) clean.push("No duplicate document or vendor-and-amount in the last 45 days.");
  const headline = d.outcome === "READY" || (d.rationale ?? "").startsWith("Certified in batch")
    ? `Every check passed and the amount is under the ${r.category} batch limit, so this went to a release batch for a supervisor to certify.`
    : d.triggers.length === 1 ? `One thing needs a person: ${flags[0].title.toLowerCase()}.` : `${d.triggers.length} things need a person.`;
  const summary = await writeExplanation({ headline, flags, clean, category: r.category, requestedCents: r.requestedCents, vendorNameRaw: r.vendorNameRaw, caseNote: r.caseNote });
  return { headline, flags, clean, summary, memorySource: memoryStats.lastQuerySource, memoryError: memoryStats.lastError };
}

// ---------- helpers ----------
function describe(e: Extracted | null) {
  if (!e) return "no extraction";
  const parts = [];
  if (e.vendorName) parts.push(`vendor "${e.vendorName.value}" (${pct(e.vendorName.confidence)})`);
  if (e.amountCents) parts.push(`amount $${(e.amountCents.value / 100).toFixed(2)} (${pct(e.amountCents.confidence)})`);
  if (e.lineItems?.value.length) parts.push(`items: ${e.lineItems.value.map((l) => `${l.label} $${(l.cents / 100).toFixed(2)}${l.flag && l.flag !== "other" ? ` [${l.flag}]` : ""}`).join("; ")}`);
  if (e.notes) parts.push(`notes: ${e.notes}`);
  return parts.join("; ");
}
const pct = (c: number) => `${Math.round(c * 100)}%`;
function noiseOf(raw: string | null) { if (!raw) return 0; let n = 0; if (/TOTAI|AMOUNT DUE:/.test(raw)) n++; if (/…/.test(raw)) n++; if (/\$\d{4,}(?!\.)/.test(raw)) n += 2; if (/[Ol]\d|\d[Ol]/.test(raw)) n++; return Math.min(3, n); }

// ---------- 7. memory (Moss): build indexes lazily, query precedents ----------
let memoryBuilt = false;
export async function ensureMemory(force = false) {
  if (memoryBuilt && !force) return;
  const m = memory();
  const grants = db.select().from(schema.grantStreams).all();
  const vendors = db.select().from(schema.vendors).all();
  const decided = db.select({ d: schema.decisions, r: schema.requests }).from(schema.decisions).innerJoin(schema.requests, eq(schema.decisions.requestId, schema.requests.id)).all();
  await m.rebuild([
    ...corpusDocs(), // procedures manual, HUD/2 CFR excerpts, last year's supervisor decisions
    ...policyDocs(grants),
    ...vendors.map(vendorDoc),
    ...decided.map(({ d, r }) => decisionDoc({ requestId: r.id, category: r.category, requestedCents: r.requestedCents, vendorNameRaw: r.vendorNameRaw, caseNote: r.caseNote, outcome: d.outcome, decidedBy: d.decidedBy === "HUMAN" ? `HUMAN ${d.humanId}` : "SYSTEM", rationale: d.rationale, triggers: d.triggers })),
  ]);
  memoryBuilt = true;
}

export async function precedents(requestId: string) {
  const r = db.select().from(schema.requests).where(eq(schema.requests.id, requestId)).get();
  const d = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, requestId)).get();
  if (!r) return { source: memoryStats.lastQuerySource, error: memoryStats.lastError, decisions: [], clauses: [], vendors: [] };
  await ensureMemory();
  const m = memory();
  const q = `${r.category} $${(r.requestedCents / 100).toFixed(0)} to ${r.vendorNameRaw}. ${r.caseNote} ${d?.triggers.map((t) => t.reason).join(" ") ?? ""}`;
  const codes = d?.triggers.map((t) => t.code) ?? [];
  const [decisions, clauses, vendorsHits] = await Promise.all([
    m.query("decision", `${q} ${codes.join(" ")}`, 12).then((hits) => rankByCodes(hits.filter((h) => h.id !== requestId && h.metadata?.decidedBy?.startsWith("HUMAN")), codes).slice(0, 3)), // people's reasoning only
    m.query("policy", `${q} ${codes.map((c) => TRIGGER[c]?.title ?? c).join(". ")}`, 8).then((hits) => rankByCodes(hits, codes).slice(0, 3)),
    m.query("vendor", (d?.matchResult as { docVendorName?: string })?.docVendorName ?? r.vendorNameRaw, 3),
  ]);
  return { source: memoryStats.lastQuerySource, error: memoryStats.lastError, decisions, clauses, vendors: vendorsHits };
}

export { currentMode, desc, and };
