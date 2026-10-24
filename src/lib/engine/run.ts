// Pure orchestration of the two engines + decision for ONE request. No I/O.
// The pipeline (with DB, LLM, adapters) wraps this; tests call it directly.
import type { Client, GrantStream, RuleProposal } from "@/db/schema";
import type { Category, Extracted } from "@/db/types";
import { evaluatePolicy, buildPolicyCtx, type HistoryItem, type PolicyResult } from "./policy";
import { match, normalizeVendor, type CrsResult, type MatchInput, type MatchResult } from "./match";
import { decide, type SystemDecision } from "./decide";
import type { RuleCtx } from "./rules";

export type RunInput = {
  request: { id: string; clientId: string; category: Category; requestedCents: number; vendorNameRaw: string; requestedAt: string };
  client: Pick<Client, "id" | "dob" | "programs">;
  extracted: Extracted | null;
  documentHashes: string[];
  grants: GrantStream[];
  vendors: MatchInput["vendors"];
  bank: MatchInput["bank"];
  crs: CrsResult | null;
  history: HistoryItem[];
  activeRules: Pick<RuleProposal, "id" | "predicate" | "action" | "rationale">[];
  limits: Record<Category, number>;
  today: string;
};

export type RunResult = { policy: PolicyResult; matchRes: MatchResult; decision: SystemDecision; ctx: RuleCtx };

export function runChecks(i: RunInput): RunResult {
  const policy = evaluatePolicy({
    request: i.request, client: i.client, extracted: i.extracted, documentHashes: i.documentHashes,
    grants: i.grants, history: i.history, activeRules: i.activeRules, limits: i.limits, today: i.today,
  });
  const matchRes = match({ request: i.request, extracted: i.extracted, vendors: i.vendors, bank: i.bank, crs: i.crs });

  const ctx: RuleCtx = {
    ...buildPolicyCtx(
      { request: i.request, client: i.client, extracted: i.extracted, documentHashes: i.documentHashes, grants: i.grants, history: i.history, activeRules: i.activeRules, limits: i.limits, today: i.today },
      policy.clientAgeYears,
      normalizeVendor(i.request.vendorNameRaw),
    ),
    "match.vendorConfidence": matchRes.vendorConfidence,
    "match.bankConfidence": matchRes.bankConfidence,
    "vendor.crsStatus": matchRes.crsStatus,
    "grant.id": policy.allocation[0]?.grantId ?? null,
  };

  const decision = decide({ category: i.request.category, requestedCents: i.request.requestedCents, policy, matchRes, limits: i.limits, activeRules: i.activeRules, ctx });
  return { policy, matchRes, decision, ctx };
}
