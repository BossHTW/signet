// Rule DSL evaluator, proposal templates, and replay. Pure.
import type { FieldPath, Predicate, RuleAction, TriggerCode } from "@/db/types";
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

/** Deterministic templates: the human's resolution + the trigger they acted on → a proposed rule. */
export function proposeRule(args: {
  chosenTrigger: TriggerCode;
  category: string;
  vendorNameRaw: string;
  lineItemFlags: string[];
  humanOutcome: "APPROVED" | "DENIED";
}): ProposalDraft {
  const { chosenTrigger, category, vendorNameRaw, lineItemFlags, humanOutcome } = args;
  switch (chosenTrigger) {
    case "DUP-HIT":
      return {
        title: "Escalate repeat vendor+amount within 45 days",
        action: "escalate",
        predicate: { all: [
          { field: "history.sameVendor45dCount", op: "gte", value: 1 },
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
      return humanOutcome === "APPROVED"
        ? {
            title: `Treat "${vendorNameRaw}" as a known alias`,
            action: "allow_within_limit",
            predicate: { all: [
              { field: "vendor.normalizedName", op: "eq", value: normalizeVendor(vendorNameRaw) },
              { field: "match.vendorConfidence", op: "gte", value: 0.6 },
            ] },
          }
        : {
            title: `Always escalate "${vendorNameRaw}"`,
            action: "escalate",
            predicate: { field: "request.vendorNameRaw", op: "matches", value: escapeRe(vendorNameRaw) },
          };
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

export type ReplayItem = { requestId: string; ctx: RuleCtx; decidedBy: "SYSTEM" | "HUMAN"; outcome: "APPROVED" | "ESCALATED" | "DENIED"; triggerCodes: TriggerCode[] };

export function replay(rule: { predicate: Predicate; action: RuleAction }, history: ReplayItem[]) {
  const matched = history.filter((h) => evalPredicate(rule.predicate, h.ctx));
  const wouldChange = matched.filter((h) =>
    (rule.action === "escalate" && h.decidedBy === "SYSTEM" && h.outcome === "APPROVED") ||
    (rule.action === "allow_within_limit" && h.outcome !== "APPROVED" && h.triggerCodes.length === 1 && h.triggerCodes[0] === "MATCH-LOW"),
  );
  return { matched: matched.length, wouldChange: wouldChange.length, ids: wouldChange.map((h) => h.requestId).slice(0, 20) };
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
