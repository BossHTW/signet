import { describe, it, expect } from "vitest";
import { generate } from "../scripts/generate";
import { runChecks } from "../src/lib/engine/run";
import { normalizeVendor } from "../src/lib/engine/match";
import { applyClaudeDraft, evalPredicate, proposeRule, replay, type ReplayItem, type RuleCtx } from "../src/lib/engine/rules";
import { FIELD_PATHS, DEFAULT_LIMITS, type Trigger } from "../src/db/types";
import type { GrantStream } from "../src/db/schema";
import type { HistoryItem } from "../src/lib/engine/policy";
import { runWorld, truthExtract } from "./harness";

const seed = generate();
const world = runWorld(seed);
const base = world.find((o) => o.result.decision.outcome === "READY" && o.result.decision.allocation.length === 1 && o.result.decision.triggers.length === 0)!;

const allow = {
  id: "r_allow",
  action: "allow_within_limit" as const,
  rationale: "A person approved this vendor within the limit",
  predicate: {
    all: [
      { field: "vendor.normalizedName" as const, op: "eq" as const, value: normalizeVendor(base.req.vendorNameRaw) },
      { field: "request.category" as const, op: "eq" as const, value: base.req.category },
    ],
  },
};
const escalate = { ...allow, id: "r_esc", action: "escalate" as const, rationale: "Always look at this vendor" };

function history(byHash: boolean): HistoryItem[] {
  return [{
    requestId: base.req.id,
    clientId: "other_client",
    clientDisplayName: "Other Client",
    vendorNormalized: normalizeVendor(base.req.vendorNameRaw),
    requestedCents: base.req.requestedCents,
    requestedAt: base.req.requestedAt,
    documentHashes: byHash ? base.req.documents.map((d) => d.sourceHash) : ["hash_other_doc"],
    allocation: base.result.decision.allocation,
    outcome: "READY",
  }];
}

function run(opts: { byHash: boolean; rules: { id: string; action: "allow_within_limit" | "escalate" | "flag"; rationale: string; predicate: typeof allow.predicate }[] }) {
  const q = base.req;
  const client = seed.clients.find((c) => c.id === q.clientId)!;
  const vendor = seed.vendors.find((v) => v.id === q.vendorId);
  return runChecks({
    request: { ...q, id: q.id + "_again" },
    client,
    extracted: truthExtract(q),
    documentHashes: q.documents.map((d) => d.sourceHash),
    grants: seed.grants as unknown as GrantStream[],
    vendors: seed.vendors,
    bank: seed.bank,
    crs: vendor ? { status: vendor.crsStatus, source: "MOCK" } : null,
    history: history(opts.byHash),
    activeRules: opts.rules,
    limits: DEFAULT_LIMITS,
    today: seed.today,
  });
}

const dupOther: Trigger = { code: "DUP-HIT", reason: "Same vendor and amount already submitted.", evidence: { clientId: "other_client", byHash: false } };
const bankLow: Trigger = { code: "BANK-LOW", reason: "No bank posting matches this invoice." };

describe("an approval waives only the flags a person is allowed to waive", () => {
  it("allows a non-hash duplicate from a different client", () => {
    const bare = run({ byHash: false, rules: [] });
    expect(bare.decision.triggers.map((t) => t.code)).toContain("DUP-HIT");
    expect(bare.decision.triggers.find((t) => t.code === "DUP-HIT")?.evidence?.byHash).not.toBe(true);
    const decided = run({ byHash: false, rules: [allow] });
    expect(decided.decision.outcome).toBe("READY");
    expect(decided.decision.triggers.map((t) => t.code)).not.toContain("DUP-HIT");
  });

  it("does not waive a reused receipt", () => {
    const decided = run({ byHash: true, rules: [allow] });
    expect(decided.decision.triggers.some((t) => t.code === "DUP-HIT" && t.evidence?.byHash === true)).toBe(true);
    expect(decided.decision.outcome).toBe("ESCALATED");
  });

  it("an escalate rule still wins when an allow rule also matches", () => {
    const decided = run({ byHash: false, rules: [allow, escalate] });
    expect(decided.decision.triggers.map((t) => t.code)).toContain("RULE-ESC");
    expect(decided.decision.outcome).toBe("ESCALATED");
  });

  it("proposes allow on an approved different-client duplicate, and escalate on a denial", () => {
    const approved = proposeRule({ chosenTrigger: "DUP-HIT", chosenTriggerObj: dupOther, clientId: base.req.clientId, category: base.req.category, vendorNameRaw: base.req.vendorNameRaw, lineItemFlags: [], humanOutcome: "APPROVED" });
    expect(approved.action).toBe("allow_within_limit");
    const denied = proposeRule({ chosenTrigger: "DUP-HIT", chosenTriggerObj: dupOther, clientId: base.req.clientId, category: base.req.category, vendorNameRaw: base.req.vendorNameRaw, lineItemFlags: [], humanOutcome: "DENIED" });
    expect(denied.action).toBe("escalate");
  });

  it("an approved missing bank posting is only a flag", () => {
    const draft = proposeRule({ chosenTrigger: "BANK-LOW", chosenTriggerObj: bankLow, clientId: base.req.clientId, category: "rent", vendorNameRaw: "Harbor View", lineItemFlags: [], humanOutcome: "APPROVED" });
    expect(draft.action).toBe("flag");
    expect(draft.action).not.toBe("allow_within_limit");
  });
});

function ctx(over: Partial<RuleCtx> = {}): RuleCtx {
  const c = {} as RuleCtx;
  for (const f of FIELD_PATHS) c[f] = null;
  return { ...c, ...over };
}

describe("Claude can narrow a rule, and cannot widen it or choose the action", () => {
  const template = proposeRule({ chosenTrigger: "DUP-HIT", chosenTriggerObj: dupOther, clientId: base.req.clientId, category: base.req.category, vendorNameRaw: base.req.vendorNameRaw, lineItemFlags: [], humanOutcome: "APPROVED" });
  const source = ctx({ "vendor.normalizedName": normalizeVendor(base.req.vendorNameRaw), "request.category": base.req.category, "request.requestedCents": base.req.requestedCents });
  const history: ReplayItem[] = [
    { requestId: "in", ctx: source, decidedBy: "SYSTEM", outcome: "ESCALATED", triggerCodes: ["DUP-HIT"], clientId: "c1", triggers: [dupOther] },
    { requestId: "out", ctx: ctx({ "vendor.normalizedName": "someone else", "request.category": "phone", "request.requestedCents": 100 }), decidedBy: "SYSTEM", outcome: "ESCALATED", triggerCodes: ["DUP-HIT"], clientId: "c2", triggers: [dupOther] },
  ];

  async function draftWith(drafter: () => Promise<{ title: string; predicate: unknown; action?: string; model?: string } | null>) {
    return applyClaudeDraft(template, source, await drafter());
  }

  it("a widening predicate stays inside the template's matches", async () => {
    const out = await draftWith(async () => ({ title: "Anyone but x", predicate: { field: "vendor.normalizedName", op: "neq", value: "x" }, action: "escalate", model: "claude-test" }));
    const templateIds = history.filter((h) => evalPredicate(template.predicate, h.ctx)).map((h) => h.requestId);
    const finalIds = history.filter((h) => evalPredicate(out.predicate, h.ctx)).map((h) => h.requestId);
    expect(finalIds.every((id) => templateIds.includes(id))).toBe(true);
    expect(finalIds).not.toContain("out");
    expect(replay({ predicate: out.predicate, action: out.action }, history).matched).toBeLessThanOrEqual(replay(template, history).matched);
    expect(out.action).toBe(template.action);
  });

  it("an unknown field or a predicate that misses this request falls back to the template", async () => {
    const unknown = await draftWith(async () => ({ title: "Read the receipt", predicate: { field: "document.text", op: "contains", value: "secret" }, model: "claude-test" }));
    expect(unknown.draftedBy).toBe("template");
    expect(unknown.predicate).toEqual(template.predicate);
    expect(unknown.title).toBe(template.title);
    expect(unknown.claudePredicate).toBeNull();
    const misses = await draftWith(async () => ({ title: "Under a dollar", predicate: { field: "request.requestedCents", op: "lte", value: 1 }, model: "claude-test" }));
    expect(misses.draftedBy).toBe("template");
    expect(misses.predicate).toEqual(template.predicate);
  });

  it("never takes the action from the drafter", async () => {
    const out = await draftWith(async () => ({ title: "Cap this vendor", predicate: { field: "request.requestedCents", op: "lte", value: base.req.requestedCents }, action: "escalate", model: "claude-test" }));
    expect(template.action).toBe("allow_within_limit");
    expect(out.action).toBe("allow_within_limit");
    expect(out.draftedBy).toBe("claude:claude-test");
    expect(out.predicate).toEqual({ all: [template.predicate, { field: "request.requestedCents", op: "lte", value: base.req.requestedCents }] });
  });
});
