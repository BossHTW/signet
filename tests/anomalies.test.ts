import { describe, it, expect } from "vitest";
import { runWorld, byAnomaly, codes } from "./harness";

const world = runWorld();

describe("the eight planted anomalies are caught by the deterministic engines", () => {
  it("1 VENDOR_NAME_MISMATCH → MATCH-LOW and BANK-LOW, escalated", () => {
    const o = byAnomaly(world, "VENDOR_NAME_MISMATCH");
    expect(codes(o)).toContain("MATCH-LOW");
    expect(codes(o)).toContain("BANK-LOW");
    expect(o.result.decision.outcome).toBe("ESCALATED");
  });

  it("2 SPLIT_FUNDER → SPLIT-REQ with TYHF $1,000 + RRDP $200, and LIMIT-OVER", () => {
    const o = byAnomaly(world, "SPLIT_FUNDER");
    expect(codes(o)).toContain("SPLIT-REQ");
    expect(codes(o)).toContain("LIMIT-OVER");
    expect(o.result.policy.allocation).toEqual([{ grantId: "TYHF", cents: 100_000 }, { grantId: "RRDP", cents: 20_000 }]);
    expect(o.result.decision.outcome).toBe("ESCALATED");
  });

  it("3 PROHIBITED_LATE_FEE → POL-HARD naming the late fee under EUSG", () => {
    const o = byAnomaly(world, "PROHIBITED_LATE_FEE");
    const hard = o.result.policy.hardFails.find((t) => /late/i.test(t.reason));
    expect(hard).toBeTruthy();
    expect(hard!.reason).toContain("EUSG");
    expect(o.result.decision.outcome).toBe("ESCALATED");
  });

  it("4 DUPLICATE_TWO_NAMES → DUP-HIT by identical document hash, pointing at the earlier request", () => {
    const o = byAnomaly(world, "DUPLICATE_TWO_NAMES");
    const dup = o.result.decision.triggers.find((t) => t.code === "DUP-HIT");
    expect(dup).toBeTruthy();
    expect(dup!.evidence?.byHash).toBe(true);
    expect(dup!.evidence?.clientId).not.toBe(o.req.clientId);
    expect(o.result.decision.outcome).toBe("ESCALATED");
  });

  it("5 OUTSIDE_PERIOD → no FRTF eligibility; GCAF catches it; LIMIT-OVER for transit", () => {
    const o = byAnomaly(world, "OUTSIDE_PERIOD");
    expect(o.result.policy.eligibleGrants).not.toContain("FRTF");
    expect(o.result.policy.eligibleGrants).toContain("GCAF");
    expect(codes(o)).toContain("LIMIT-OVER");
    expect(o.result.decision.outcome).toBe("ESCALATED");
  });

  it("6 INELIGIBLE_AGE → only GCAF eligible, cannot fund $900 within caps → POL-HARD", () => {
    const o = byAnomaly(world, "INELIGIBLE_AGE");
    expect(o.result.policy.eligibleGrants).toEqual(["GCAF"]);
    expect(o.result.policy.hardFails.some((t) => /within grant caps/.test(t.reason))).toBe(true);
    expect(o.result.decision.outcome).toBe("ESCALATED");
  });

  it("7 CRS_FLAGGED_VENDOR → VENDOR-FLAG and LIMIT-OVER", () => {
    const o = byAnomaly(world, "CRS_FLAGGED_VENDOR");
    expect(codes(o)).toContain("VENDOR-FLAG");
    expect(codes(o)).toContain("LIMIT-OVER");
    expect(o.result.decision.outcome).toBe("ESCALATED");
  });

  it("8 AMOUNT_MISMATCH → AMT-DIFF ($405 on bill vs $450 requested)", () => {
    const o = byAnomaly(world, "AMOUNT_MISMATCH");
    const t = o.result.decision.triggers.find((x) => x.code === "AMT-DIFF");
    expect(t).toBeTruthy();
    expect(t!.evidence).toMatchObject({ extracted: 40_500, requested: 45_000 });
    expect(o.result.decision.outcome).toBe("ESCALATED");
  });
});

describe("the normal workload mostly auto-approves", () => {
  const normal = world.filter((o) => !o.req.plantedAnomaly);
  it("at least 75% of non-planted requests are APPROVED by the system", () => {
    const approved = normal.filter((o) => o.result.decision.outcome === "APPROVED").length;
    expect(approved / normal.length).toBeGreaterThanOrEqual(0.75);
  });
  it("the three legitimate splits escalate with SPLIT-REQ (a human confirms allocations)", () => {
    const splits = normal.filter((o) => o.req.category === "rent" && o.req.requestedCents >= 110_000);
    expect(splits.length).toBe(3);
    for (const s of splits) expect(codes(s)).toContain("SPLIT-REQ");
  });
  it("nothing is ever DENIED by the system", () => {
    for (const o of world) expect(o.result.decision.outcome).not.toBe("DENIED");
  });
});
