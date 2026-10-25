// Rule DSL evaluator, proposal templates, and replay. Pure.
import { FIELD_PATHS, OPS, type FieldPath, type Predicate, type RuleAction, type Trigger, type TriggerCode } from "@/db/types";
import { normalizeVendor } from "./match";

export type RuleCtx = Record<FieldPath, unknown>;

export function evalPredicate(p: Predicate, ctx: RuleCtx): boolean {
  if ("all" in p) return p.all.every((x) => evalPredicate(x, ctx));
  if ("any" in p) return p.any.some((x) => evalPredicate(x, ctx));
  if ("not" in p) return !evalPredicate(p.not, ctx);
  const v = ctx[p.field];
  switch (p.op) {
    case "eq": return v === p.value;
    case "neq": return v !== p.value;
    case "gt": return typeof v === "number" && v > (p.value as number);
    case "gte": return typeof v === "number" && v >= (p.value as number);
    case "lt": return typeof v === "number" && v < (p.value as number);
    case "lte": return typeof v === "number" && v <= (p.value as number);
    case "in": return Array.isArray(p.value) && (p.value as unknown[]).includes(v);
    case "contains": return Array.isArray(v) ? v.includes(p.value) : String(v ?? "").includes(String(p.value));
    case "matches": {
      try { return new RegExp(String(p.value), "i").test(String(v ?? "")); } catch { return false; }
    }
  }
}

/** Validate a predicate shape coming from the human's JSON editor. Returns an error string or null. */
export function validatePredicate(p: unknown, depth = 0): string | null {
  if (depth > 6) return "Predicate too deep";
  if (!p || typeof p !== "object") return "Predicate must be an object";
  const o = p as Record<string, unknown>;
  if ("all" in o || "any" in o) {
    const arr = (o.all ?? o.any) as unknown;
    if (!Array.isArray(arr) || !arr.length) return "'all'/'any' must be a non-empty array";
    for (const x of arr) { const e = validatePredicate(x, depth + 1); if (e) return e; }
    return null;
  }
  if ("not" in o) return validatePredicate(o.not, depth + 1);
  if (typeof o.field !== "string" || typeof o.op !== "string" || !("value" in o)) return "Leaf needs field, op, value";
  return null;
}

export type ProposalDraft = { predicate: Predicate; action: RuleAction; title: string };

export type DraftedRule = {
  predicate: Predicate;
  title: string;
  action: RuleAction;
  draftedBy: `claude:${string}` | "template";
  templatePredicate: Predicate;
  claudePredicate: Predicate | null;
};

const FIELD_SET = new Set<string>(FIELD_PATHS);
const OP_SET = new Set<string>(OPS);

function fieldsAllowed(p: Predicate): boolean {
  if ("all" in p) return p.all.every(fieldsAllowed);
  if ("any" in p) return p.any.every(fieldsAllowed);
  if ("not" in p) return fieldsAllowed(p.not);
  return FIELD_SET.has(p.field) && OP_SET.has(p.op);
}

/** Keep the template's action. A model predicate is kept only when it is well-formed and, AND-ed with the template, still matches the request it came from. */
export function applyClaudeDraft(
  template: ProposalDraft,
  ctx: RuleCtx,
  claude: { title?: unknown; predicate?: unknown; model?: unknown } | null,
): DraftedRule {
  const plain: DraftedRule = { predicate: template.predicate, title: template.title, action: template.action, draftedBy: "template", templatePredicate: template.predicate, claudePredicate: null };
  if (!claude) return plain;
  const title = typeof claude.title === "string" ? claude.title.replace(/\s+/g, " ").trim().slice(0, 80) : "";
  if (!title || validatePredicate(claude.predicate) || !fieldsAllowed(claude.predicate as Predicate)) return plain;
  const claudePredicate = claude.predicate as Predicate;
  const predicate: Predicate = { all: [template.predicate, claudePredicate] };
  if (!evalPredicate(predicate, ctx)) return plain;
  const model = typeof claude.model === "string" && claude.model ? claude.model : "claude";
  return { predicate, title, action: template.action, draftedBy: model.startsWith("claude:") ? model as `claude:${string}` : `claude:${model}`, templatePredicate: template.predicate, claudePredicate };
}

export function isWaivable(t: Trigger, clientId: string): boolean {
  if (t.code === "MATCH-LOW" || t.code === "PUBLIC-NONE") return true;
  if (t.code === "DUP-HIT") return t.evidence?.byHash !== true && t.evidence?.clientId !== clientId;
  return false;
}

export const WAIVE_COPY = {
  can: "vendor-name mismatch, no public record, same vendor & amount from a different client",
  never: "a reused receipt, eligibility, caps, prohibited items, amount mismatches, a missing bank posting, identity flags",
};

const vendorCategory = (vendorNameRaw: string, category: string): Predicate => ({
  all: [
    { field: "vendor.normalizedName", op: "eq", value: normalizeVendor(vendorNameRaw) },
    { field: "request.category", op: "eq", value: category },
  ],
});

/** Deterministic templates: the human's resolution + the trigger they acted on → a proposed rule. */
export function proposeRule(args: {
  chosenTrigger: TriggerCode;
  category: string;
  vendorNameRaw: string;
  lineItemFlags: string[];
  humanOutcome: "APPROVED" | "DENIED";
  chosenTriggerObj?: Trigger;
  clientId?: string;
}): ProposalDraft {
  const { chosenTrigger, category, vendorNameRaw, lineItemFlags, humanOutcome, chosenTriggerObj, clientId } = args;
  if (humanOutcome === "APPROVED") {
    const predicate = vendorCategory(vendorNameRaw, category);
    const waivable = chosenTriggerObj ? isWaivable(chosenTriggerObj, clientId ?? "") : false;
    if (waivable) {
      return { action: "allow_within_limit", title: `Allow "${vendorNameRaw}" ${category} requests within the limit`, predicate };
    }
    return { action: "flag", title: `"${vendorNameRaw}" approved by a person; ${chosenTrigger} still needs review every time`, predicate };
  }
  switch (chosenTrigger) {
    case "DUP-HIT":
      return {
        title: "Escalate when the same vendor and amount were already paid within 45 days",
        action: "escalate",
        predicate: { all: [
          { field: "history.sameVendorAmount45dCount", op: "gte", value: 1 },
          { field: "request.category", op: "eq", value: category },
        ] },
      };
    case "POL-HARD": {
      const flag = lineItemFlags.find((f) => f && f !== "other" && f !== "tax") ?? "late_fee";
      return {
        title: `Escalate any ${flag} line item`,
        action: "escalate",
        predicate: { field: "extracted.lineItems.flags", op: "contains", value: flag },
      };
    }
    case "MATCH-LOW":
      return {
        title: `Always escalate "${vendorNameRaw}"`,
        action: "escalate",
        predicate: { field: "request.vendorNameRaw", op: "matches", value: escapeRe(vendorNameRaw) },
      };
    case "PUBLIC-NONE":
      return { title: "Escalate landlords with no public record", action: "escalate", predicate: { all: [
        { field: "request.category", op: "in", value: ["rent", "deposit"] }, { field: "match.vendorConfidence", op: "lt", value: 0.95 } ] } };
    case "RENT-HIGH":
      return { title: `Flag ${category} above benchmark`, action: "flag", predicate: { field: "request.category", op: "eq", value: category } };
    case "VENDOR-FLAG":
      return {
        title: "Escalate any non-verified vendor",
        action: "escalate",
        predicate: { field: "vendor.crsStatus", op: "in", value: ["FLAGGED", "UNVERIFIED", "UNKNOWN"] },
      };
    case "AMT-DIFF":
    case "EXTRACT-LOW":
      return {
        title: `Flag ${category} requests over document amount`,
        action: "flag",
        predicate: { field: "request.category", op: "eq", value: category },
      };
    default:
      return {
        title: `Flag ${category} requests for review`,
        action: "flag",
        predicate: { field: "request.category", op: "eq", value: category },
      };
  }
}

export type ReplayItem = {
  requestId: string;
  ctx: RuleCtx;
  decidedBy: "SYSTEM" | "HUMAN";
  outcome: "READY" | "ESCALATED" | "APPROVED" | "DENIED";
  triggerCodes: TriggerCode[];
  clientId: string;
  triggers: Trigger[];
};

export function replay(rule: { predicate: Predicate; action: RuleAction }, history: ReplayItem[]) {
  const matched = history.filter((h) => evalPredicate(rule.predicate, h.ctx));
  const wouldChange = matched.filter((h) =>
    (rule.action === "escalate" && h.decidedBy === "SYSTEM" && h.outcome === "READY") ||
    (rule.action === "allow_within_limit" && h.outcome === "ESCALATED" && h.triggers.length > 0 && h.triggers.every((t) => isWaivable(t, h.clientId))),
  );
  return { matched: matched.length, wouldChange: wouldChange.length, ids: wouldChange.map((h) => h.requestId).slice(0, 20) };
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
