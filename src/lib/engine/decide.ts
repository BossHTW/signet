// The decision function. Returns APPROVED or ESCALATED. There is no code path to DENIED.
import type { Allocation, Category, Trigger } from "@/db/types";
import type { PolicyResult } from "./policy";
import type { MatchResult } from "./match";
import { evalPredicate, type RuleCtx } from "./rules";
import type { RuleProposal } from "@/db/schema";

export type SystemDecision = {
  outcome: "APPROVED" | "ESCALATED";
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
}): SystemDecision {
  let triggers: Trigger[] = [...args.policy.triggers, ...args.matchRes.triggers];

  // allow_within_limit rules can waive MATCH-LOW only (an alias the human has blessed), never a hard fail
  for (const r of args.activeRules) {
    if (r.action === "allow_within_limit" && evalPredicate(r.predicate, args.ctx)) {
      triggers = triggers.filter((t) => t.code !== "MATCH-LOW");
    }
  }
  // flag rules annotate but do not escalate on their own
  const limit = args.limits[args.category];
  const outcome: SystemDecision["outcome"] =
    triggers.length === 0 && args.requestedCents <= limit && args.policy.allocation.length === 1 ? "APPROVED" : "ESCALATED";

  return {
    outcome,
    triggers,
    allocation: args.policy.allocation,
    limitsApplied: { [args.category]: limit },
  };
}
