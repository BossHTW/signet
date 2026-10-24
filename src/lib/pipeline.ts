// The only orchestrator. Route handlers call these; no logic lives in routes.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, schema } from "@/db/client";
import type { Decision, Request, RuleProposal } from "@/db/schema";
import { DEFAULT_LIMITS, type Category, type Extracted, type Outcome, type TriggerCode } from "@/db/types";
import { runChecks } from "@/lib/engine/run";
import type { HistoryItem } from "@/lib/engine/policy";
import { normalizeVendor } from "@/lib/engine/match";
import { proposeRule, replay, validatePredicate, type ReplayItem, type RuleCtx } from "@/lib/engine/rules";
import { adapters, currentMode } from "@/lib/adapters";
import { extractDocument, heuristicExtractor, truthExtractor } from "@/lib/llm/extract";
import { writeSummary, writeDefense } from "@/lib/llm/write";
import { appendAudit } from "@/lib/audit";

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

  // --- the two engines + decision ---
  const run = runChecks({
    request: req, client, extracted, documentHashes: docs.map((d) => d.sourceHash), grants, vendors, bank: postings, crs,
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

  if (outcome === "APPROVED") {
    appendAudit({ type: "AUTO_APPROVED", actor: "system", requestId, payload: { allocation: run.decision.allocation, seal } });
    await disburse(req, run.decision.allocation, vendorGuess?.legalName ?? req.vendorNameRaw, "system");
  } else {
    db.update(schema.requests).set({ status: "ESCALATED", vendorId: run.matchRes.vendorId ?? req.vendorId }).where(eq(schema.requests.id, requestId)).run();
    appendAudit({ type: "ESCALATED", actor: "system", requestId, payload: { triggers: run.decision.triggers.map((t) => ({ code: t.code, reason: t.reason })) } });
  }
  return db.select().from(schema.decisions).where(eq(schema.decisions.requestId, requestId)).get()!;
}

async function disburse(req: Request, allocation: { grantId: string; cents: number }[], vendorName: string, actor: string) {
  const { bank } = adapters();
  const txns: { grantId: string; cents: number; txnId: string }[] = [];
  for (const a of allocation) {
    const t = await bank.transfer({ vendorId: req.vendorId ?? "", vendorName, amountCents: a.cents, memo: `${a.grantId} ${req.id}` });
    txns.push({ ...a, txnId: t.txnId });
    const g = db.select().from(schema.grantStreams).where(eq(schema.grantStreams.id, a.grantId)).get();
    if (g) db.update(schema.grantStreams).set({ spentCents: g.spentCents + a.cents }).where(eq(schema.grantStreams.id, a.grantId)).run();
  }
  db.update(schema.requests).set({ status: "DISBURSED" }).where(eq(schema.requests.id, req.id)).run();
  appendAudit({ type: "DISBURSED", actor, requestId: req.id, payload: { txns, source: bank.source } });
}

// ---------- 2. human decision (the only path to DENIED) ----------
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
  db.update(schema.requests).set({ status: args.outcome }).where(eq(schema.requests.id, args.requestId)).run();
  appendAudit({ type: "HUMAN_DECIDED", actor: `human:${args.humanId}`, requestId: args.requestId, payload: { outcome: args.outcome, rationale: args.rationale, allocation, seal } });

  if (args.outcome === "APPROVED") {
    const vendor = db.select().from(schema.vendors).where(eq(schema.vendors.id, req.vendorId ?? "")).get();
    await disburse(req, allocation, vendor?.legalName ?? req.vendorNameRaw, `human:${args.humanId}`);
  }

  // propose a rule from the human's resolution
  const chosen = args.chosenTrigger ?? prior.triggers[0]?.code ?? "LIMIT-OVER";
  const lineFlags = ((db.select().from(schema.documents).where(eq(schema.documents.requestId, req.id)).get()?.extracted?.lineItems?.value) ?? []).map((l) => l.flag ?? "").filter(Boolean);
  const draft = proposeRule({ chosenTrigger: chosen, category: req.category, vendorNameRaw: req.vendorNameRaw, lineItemFlags: lineFlags, humanOutcome: args.outcome });
  const proposalId = nanoid(10);
  const impact = replayRule(draft.predicate, draft.action);
  db.insert(schema.ruleProposals).values({ id: proposalId, sourceDecisionId: prior.id, rationale: args.rationale, predicate: draft.predicate, action: draft.action, status: "PROPOSED", replayImpact: impact, createdAt: decidedAt }).run();
  appendAudit({ type: "RULE_PROPOSED", actor: "system", requestId: req.id, payload: { proposalId, title: draft.title, action: draft.action, predicate: draft.predicate, replay: impact } });
  return { proposalId, title: draft.title };
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
    return { requestId: r.id, ctx, decidedBy: d.decidedBy, outcome: d.outcome, triggerCodes: d.triggers.map((t) => t.code) };
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

export { currentMode, desc, and };
