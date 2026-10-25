"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ROLES } from "@/db/types";
import { verifyChain } from "@/lib/audit";
import { DEMO_PATH, readScenario } from "@/lib/demoScenario";
import { activateRule, attestItem, certifyBatch, humanDecide, openBatch, processRequest, releaseBatch } from "@/lib/pipeline";

const DENY = "No proof the $50 left the bank. Sent back to the caseworker for the bank statement.";
const APPROVE = "Agency-sponsored Mint Mobile family plan; one $30 line per client is expected.";

function scenario() {
  const s = readScenario();
  if (!s) throw new Error("data/demo-scenario.json is missing. Run npm run demo:snapshot.");
  return s;
}

async function actAs(role: "supervisor" | "finance") {
  (await cookies()).set("signet_role", role, { path: "/", sameSite: "lax" });
  return ROLES[role].id;
}

function touch() {
  revalidatePath(DEMO_PATH);
}

export async function runAct1(): Promise<{ error?: string }> {
  try {
    await actAs("supervisor");
    await processRequest(scenario().act1);
    touch();
    return {};
  } catch (e) { return { error: (e as Error).message }; }
}

export async function denyAct1(): Promise<{ error?: string }> {
  try {
    const humanId = await actAs("supervisor");
    await humanDecide({ requestId: scenario().act1, humanId, outcome: "DENIED", rationale: DENY, chosenTrigger: "BANK-LOW" });
    touch();
    return {};
  } catch (e) { return { error: (e as Error).message }; }
}

export async function runSix(): Promise<{ error?: string }> {
  try {
    await actAs("supervisor");
    const s = scenario();
    for (const id of [...s.mint, s.reused]) await processRequest(id);
    touch();
    return {};
  } catch (e) { return { error: (e as Error).message }; }
}

export async function approveLine1(): Promise<{ error?: string }> {
  try {
    const humanId = await actAs("supervisor");
    await humanDecide({ requestId: scenario().mint[0], humanId, outcome: "APPROVED", rationale: APPROVE, chosenTrigger: "MATCH-LOW" });
    touch();
    return {};
  } catch (e) { return { error: (e as Error).message }; }
}

export async function activateDemoRule(): Promise<{ error?: string }> {
  try {
    const humanId = await actAs("finance");
    const s = scenario();
    const decision = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, s.mint[0])).get();
    const proposal = decision ? db.select().from(schema.ruleProposals).where(eq(schema.ruleProposals.sourceDecisionId, decision.id)).get() : undefined;
    if (!proposal || proposal.status !== "PROPOSED") return { error: "no proposed rule on line 1" };
    activateRule({ proposalId: proposal.id, humanId });
    touch();
    return {};
  } catch (e) { return { error: (e as Error).message }; }
}

export async function reprocessOne(id: string): Promise<{ error?: string }> {
  try {
    await actAs("finance");
    const s = scenario();
    if (!s.mint.slice(1).includes(id)) return { error: "that request is outside the four the rule can clear" };
    await processRequest(id, { reprocess: true });
    touch();
    return {};
  } catch (e) { return { error: (e as Error).message }; }
}

function demoBatch() {
  const s = scenario();
  const ids = new Set([s.act1, ...s.mint, s.reused]);
  const open = db.select().from(schema.releaseBatches).all().find((b) => b.itemIds.some((id) => ids.has(id)) && b.status !== "RELEASED")
    ?? db.select().from(schema.releaseBatches).all().find((b) => b.itemIds.some((id) => ids.has(id)));
  return open ?? null;
}

export async function openDemoBatch(): Promise<{ error?: string }> {
  try {
    const humanId = await actAs("supervisor");
    const s = scenario();
    const allowed = new Set([s.act1, ...s.mint, s.reused]);
    const waiting = db.select({ id: schema.requests.id }).from(schema.requests)
      .innerJoin(schema.decisions, eq(schema.decisions.requestId, schema.requests.id))
      .where(and(inArray(schema.requests.status, ["READY", "APPROVED"]), isNull(schema.decisions.batchId))).all();
    const outside = waiting.filter((r) => !allowed.has(r.id));
    if (outside.length) return { error: "this database has requests outside the demo, so the batch was not opened" };
    openBatch(humanId);
    touch();
    return {};
  } catch (e) { return { error: (e as Error).message }; }
}

export async function attestDemoSample(): Promise<{ error?: string }> {
  try {
    const humanId = await actAs("supervisor");
    const batch = demoBatch();
    if (!batch) return { error: "no demo batch" };
    for (const requestId of batch.sampleIds) attestItem({ batchId: batch.id, requestId, humanId });
    touch();
    return {};
  } catch (e) { return { error: (e as Error).message }; }
}

export async function certifyDemoBatch(): Promise<{ error?: string }> {
  try {
    const humanId = await actAs("supervisor");
    const batch = demoBatch();
    if (!batch) return { error: "no demo batch" };
    certifyBatch({ batchId: batch.id, humanId });
    touch();
    return {};
  } catch (e) { return { error: (e as Error).message }; }
}

export async function releaseDemoBatch(): Promise<{ error?: string }> {
  try {
    const humanId = await actAs("finance");
    const batch = demoBatch();
    if (!batch) return { error: "no demo batch" };
    await releaseBatch({ batchId: batch.id, humanId });
    touch();
    return {};
  } catch (e) { return { error: (e as Error).message }; }
}

export async function verifyDemoChain(): Promise<{ error?: string; ok?: boolean; count?: number }> {
  try {
    await actAs("finance");
    const v = verifyChain();
    touch();
    return { ok: v.ok, count: v.count, error: v.ok ? undefined : `chain broke at event ${v.brokenAt}` };
  } catch (e) { return { error: (e as Error).message }; }
}
