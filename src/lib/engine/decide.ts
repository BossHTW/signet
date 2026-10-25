// The verification function. Returns READY (clean, within the batch limit, one grant) or ESCALATED.
// There is no code path to APPROVED, DENIED, or a payment: those belong to named humans.
import type { Allocation, Category, Trigger } from "@/db/types";
import type { PolicyResult } from "./policy";
import type { MatchResult } from "./match";
import { evalPredicate, isWaivable, type RuleCtx } from "./rules";
import type { RuleProposal } from "@/db/schema";

export type SystemDecision = {
  outcome: "READY" | "ESCALATED";
  triggers: Trigger[];
  allocation: Allocation[];
  limitsApplied: Record<string, number>;
};

export function decide(args: {
  category: Category;
  requestedCents: number;
  policy: PolicyResult;
  matchRes: MatchResult;
  limits: Record<Category, number>;
  activeRules: Pick<RuleProposal, "id" | "predicate" | "action" | "rationale">[];
  ctx: RuleCtx; // merged policy + match context
  clientId: string;
}): SystemDecision {
  let triggers: Trigger[] = [...args.policy.triggers, ...args.matchRes.triggers];

  // An allow rule drops only waivable flags. RULE-ESC is never waivable, so an escalate rule still wins.
  if (args.activeRules.some((r) => r.action === "allow_within_limit" && evalPredicate(r.predicate, args.ctx))) {
    triggers = triggers.filter((t) => !isWaivable(t, args.clientId));
  }
  // flag rules annotate but do not escalate on their own
  const limit = args.limits[args.category];
  const outcome: SystemDecision["outcome"] =
    triggers.length === 0 && args.requestedCents <= limit && args.policy.allocation.length === 1 ? "READY" : "ESCALATED";

  return {
    outcome,
    triggers,
    allocation: args.policy.allocation,
    limitsApplied: { [args.category]: limit },
  };
}
