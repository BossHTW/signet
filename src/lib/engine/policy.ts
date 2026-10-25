// Grant Policy Engine. Pure. No I/O. No Date.now(). Never returns a denial.
import type { Client, GrantStream, Request, RuleProposal } from "@/db/schema";
import type { Allocation, Category, Extracted, Field, Trigger } from "@/db/types";
import { REQUIRED_FIELDS } from "@/db/types";
import { cents, daysBetween, sum, within, yearsBetween } from "./util";
import { evalPredicate, type RuleCtx } from "./rules";
import { normalizeVendor } from "./match";

/** Minimal view of a past decision the policy engine needs (keeps the engine free of DB types). */
export type HistoryItem = {
  requestId: string;
  clientId: string;
  clientDisplayName: string;
  vendorNormalized: string;
  requestedCents: number;
  requestedAt: string;
  documentHashes: string[];
  allocation: Allocation[];
  outcome: "READY" | "ESCALATED" | "APPROVED" | "DENIED";
};

export type PolicyInput = {
  request: Pick<Request, "id" | "clientId" | "category" | "requestedCents" | "vendorNameRaw" | "requestedAt">;
  client: Pick<Client, "id" | "dob" | "programs">;
  extracted: Extracted | null;
  documentHashes: string[];
  grants: GrantStream[];
  history: HistoryItem[];
  activeRules: Pick<RuleProposal, "id" | "predicate" | "action" | "rationale">[];
  limits: Record<Category, number>;
  today: string;
};

export type PolicyResult = {
  hardFails: Trigger[];
  flags: Trigger[];
  eligibleGrants: string[];
  allocation: Allocation[];
  triggers: Trigger[];
  clientAgeYears: number;
};

const DUP_WINDOW_DAYS = 45;
const AMT_DIFF_TOLERANCE = 0.05;
const EXTRACT_MIN_CONFIDENCE = 0.8;

export function evaluatePolicy(i: PolicyInput): PolicyResult {
  const t: Trigger[] = [];
  const age = yearsBetween(i.client.dob, i.today);
  const vendorNorm = normalizeVendor(i.request.vendorNameRaw);

  // 1. Eligible grants
  const eligible = i.grants
    .filter((g) =>
      g.active &&
      within(i.request.requestedAt, g.periodStart, g.periodEnd) &&
      g.allowedCategories.includes(i.request.category) &&
      (g.eligibility.minAge == null || age >= g.eligibility.minAge) &&
      (g.eligibility.maxAge == null || age <= g.eligibility.maxAge) &&
      (!g.eligibility.programs?.length || g.eligibility.programs.some((p) => i.client.programs.includes(p))) &&
      remainingForClient(g, i.client.id, i.history) > 0 &&
      g.totalCents - g.spentCents > 0,
    )
    .sort((a, b) => a.priority - b.priority);

  if (eligible.length === 0) {
    t.push({
      code: "POL-HARD",
      reason: `No active grant allows ${i.request.category} for this client (age ${age}, programs ${i.client.programs.join("/") || "none"}) on ${i.request.requestedAt}.`,
    });
  }

  // 2. Prohibited line items against every eligible grant
  const items = i.extracted?.lineItems?.value ?? [];
  for (const li of items) {
    if (!li.flag || li.flag === "other" || li.flag === "tax") continue;
    for (const g of eligible) {
      if (g.prohibitedItems.includes(li.flag)) {
        t.push({
          code: "POL-HARD",
          reason: `Line item "${li.label}" ($${cents(li.cents)}, ${li.flag}) is prohibited under ${g.id}.`,
          evidence: { grant: g.id, cents: li.cents, flag: li.flag },
        });
      }
    }
  }

  // 3. Duplicates: same document hash anywhere, or same vendor + amount ±1% within window (any client)
  const dupByHash = i.history.find((h) => h.requestId !== i.request.id && h.documentHashes.some((d) => i.documentHashes.includes(d)));
  const dupByVendor = i.history.find(
    (h) =>
      h.requestId !== i.request.id &&
      h.vendorNormalized === vendorNorm &&
      Math.abs(h.requestedCents - i.request.requestedCents) <= i.request.requestedCents * 0.01 &&
      daysBetween(h.requestedAt, i.request.requestedAt) <= DUP_WINDOW_DAYS,
  );
  const dup = dupByHash ?? dupByVendor;
  if (dup) {
    t.push({
      code: "DUP-HIT",
      reason: `${dupByHash ? "Identical document" : "Same vendor and amount"} already submitted as ${dup.requestId} (${dup.clientDisplayName}, ${dup.requestedAt}).`,
      evidence: { requestId: dup.requestId, clientId: dup.clientId, byHash: Boolean(dupByHash) },
    });
  }

  // 4. Amount vs document; extraction confidence on required fields
  const ext = i.extracted?.amountCents;
  if (ext && Math.abs(ext.value - i.request.requestedCents) / i.request.requestedCents > AMT_DIFF_TOLERANCE) {
    t.push({
      code: "AMT-DIFF",
      reason: `Document shows $${cents(ext.value)}; request says $${cents(i.request.requestedCents)}.`,
      evidence: { extracted: ext.value, requested: i.request.requestedCents },
    });
  }
  if (i.extracted) {
    for (const key of REQUIRED_FIELDS[i.request.category]) {
      const f = i.extracted[key] as Field<unknown> | undefined;
      if (!f) {
        t.push({ code: "EXTRACT-LOW", reason: `Agent could not find ${key} on the document.` });
      } else if (f.confidence < EXTRACT_MIN_CONFIDENCE) {
        t.push({ code: "EXTRACT-LOW", reason: `Agent could not read ${key} confidently (${Math.round(f.confidence * 100)}%).`, evidence: { field: key, confidence: f.confidence } });
      }
    }
  }

  // 5. Allocation (greedy by priority; respects per-instance, per-client-period and remaining)
  const allocation = allocate(i.request.requestedCents, eligible, i.client.id, i.history);
  if (allocation.length > 1) {
    t.push({
      code: "SPLIT-REQ",
      reason: `Needs split funding: ${allocation.map((a) => `${a.grantId} $${cents(a.cents)}`).join(" + ")}.`,
      evidence: { allocation },
    });
  }
  if (eligible.length && sum(allocation) < i.request.requestedCents) {
    t.push({
      code: "POL-HARD",
      reason: `Only $${cents(sum(allocation))} of $${cents(i.request.requestedCents)} can be funded within grant caps.`,
      evidence: { fundable: sum(allocation) },
    });
  }

  // 6. Auto-approve limit
  const limit = i.limits[i.request.category];
  if (i.request.requestedCents > limit) {
    t.push({
      code: "LIMIT-OVER",
      reason: `$${cents(i.request.requestedCents)} exceeds the $${cents(limit)} batch limit for ${i.request.category}.`,
      evidence: { limit },
    });
  }

  // 7. Human-approved rules
  const ctx = buildPolicyCtx(i, age, vendorNorm);
  for (const r of i.activeRules) {
    if (r.action === "escalate" && evalPredicate(r.predicate, ctx)) {
      t.push({ code: "RULE-ESC", reason: `Rule ${r.id}: ${r.rationale}`, evidence: { ruleId: r.id } });
    }
  }

  return {
    hardFails: t.filter((x) => x.code === "POL-HARD"),
    flags: t.filter((x) => x.code !== "POL-HARD"),
    eligibleGrants: eligible.map((g) => g.id),
    allocation,
    triggers: t,
    clientAgeYears: age,
  };
}

export function remainingForClient(g: GrantStream, clientId: string, history: HistoryItem[]): number {
  const spent = history
    .filter((h) => h.clientId === clientId && (h.outcome === "APPROVED" || h.outcome === "READY")) // committed, not only released
    .flatMap((h) => h.allocation)
    .filter((a) => a.grantId === g.id)
    .reduce((s, a) => s + a.cents, 0);
  return Math.max(0, g.perClientPeriodCapCents - spent);
}

export function allocate(amount: number, grants: GrantStream[], clientId: string, history: HistoryItem[]): Allocation[] {
  const out: Allocation[] = [];
  let left = amount;
  for (const g of grants) {
    if (left <= 0) break;
    const room = Math.min(g.perInstanceCapCents, remainingForClient(g, clientId, history), g.totalCents - g.spentCents);
    const take = Math.min(room, left);
    if (take > 0) {
      out.push({ grantId: g.id, cents: take });
      left -= take;
    }
  }
  return out;
}

/** Partial rule context from the policy side; the pipeline merges match data in later. */
export function buildPolicyCtx(i: PolicyInput, age: number, vendorNorm: string): RuleCtx {
  const sameVendor45d = i.history.filter(
    (h) => h.requestId !== i.request.id && h.vendorNormalized === vendorNorm && daysBetween(h.requestedAt, i.request.requestedAt) <= DUP_WINDOW_DAYS,
  ).length;
  const sameVendorAmount45d = i.history.filter(
    (h) => h.requestId !== i.request.id && h.vendorNormalized === vendorNorm && daysBetween(h.requestedAt, i.request.requestedAt) <= DUP_WINDOW_DAYS &&
      Math.abs(h.requestedCents - i.request.requestedCents) <= i.request.requestedCents * 0.01,
  ).length;
  return {
    "history.sameVendorAmount45dCount": sameVendorAmount45d,
    "request.category": i.request.category,
    "request.requestedCents": i.request.requestedCents,
    "request.vendorNameRaw": i.request.vendorNameRaw,
    "request.clientAgeYears": age,
    "extracted.lineItems.flags": (i.extracted?.lineItems?.value ?? []).map((l) => l.flag).filter(Boolean),
    "extracted.amountCents": i.extracted?.amountCents?.value ?? null,
    "match.vendorConfidence": null,
    "match.bankConfidence": null,
    "vendor.crsStatus": null,
    "vendor.normalizedName": vendorNorm,
    "grant.id": null,
    "history.sameVendor45dCount": sameVendor45d,
  };
}
