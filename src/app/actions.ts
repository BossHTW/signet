"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { vendorPublicRecord, type PublicRecord } from "@/lib/adapters/public";
import { resetDemo } from "@/lib/demo";
import { activateRule, attestItem, certifyBatch, createRequest, humanDecide, openBatch, processAllPending, processRequest, rejectRule, releaseBatch, retireRule } from "@/lib/pipeline";
import { generateReports } from "@/lib/reports";
import { currentHuman, requireRole } from "@/lib/role";
import type { Category, Role, TriggerCode } from "@/db/types";

const all = () => ["/today", "/queue", "/batches", "/rules", "/audit", "/reports", "/metrics"].forEach((p) => revalidatePath(p));

export async function switchRoleAction(formData: FormData) {
  const role = String(formData.get("role")) as Role;
  (await cookies()).set("signet_role", role === "finance" ? "finance" : "supervisor", { path: "/", sameSite: "lax" });
  all();
  redirect(String(formData.get("back") ?? "/queue"));
}

// Approver decides an escalation. APPROVED here is a certification; money still waits for a release.
export async function decideAction(formData: FormData) {
  const me = await currentHuman();
  requireRole(me.role, "supervisor", "Deciding an escalation");
  const requestId = String(formData.get("requestId"));
  const outcome = String(formData.get("outcome")) as "APPROVED" | "DENIED";
  const rationale = String(formData.get("rationale") ?? "");
  const chosenTrigger = (formData.get("chosenTrigger") ? String(formData.get("chosenTrigger")) : undefined) as TriggerCode | undefined;
  const allocRaw = String(formData.get("allocation") ?? "").trim();
  let allocation: { grantId: string; cents: number }[] | undefined;
  if (allocRaw) {
    allocation = allocRaw.split(",").map((p) => { const [g, d] = p.split(":"); return { grantId: g.trim(), cents: Math.round(Number(d) * 100) }; }).filter((a) => a.grantId && a.cents > 0);
  }
  await humanDecide({ requestId, humanId: me.id, outcome, rationale, allocation, chosenTrigger });
  all(); revalidatePath(`/requests/${requestId}`);
  const back = String(formData.get("back") ?? "");
  redirect(back || (String(formData.get("flow") ?? "") === "1" ? "/review?step=decide" : `/requests/${requestId}?sealed=1`));
}

// Release batches: open + attest + certify (Approver), release (Releaser).
export async function openBatchAction() {
  const me = await currentHuman();
  requireRole(me.role, "supervisor", "Opening a release batch");
  openBatch(me.id);
  all();
  redirect("/review?step=sample");
}
export async function attestAction(formData: FormData) {
  const me = await currentHuman();
  requireRole(me.role, "supervisor", "Attesting an item");
  const batchId = String(formData.get("batchId")); const requestId = String(formData.get("requestId"));
  attestItem({ batchId, requestId, humanId: me.id });
  all(); revalidatePath(`/batches/${batchId}`); revalidatePath(`/requests/${requestId}`);
  redirect(String(formData.get("back") ?? `/batches/${batchId}`));
}
export async function certifyBatchAction(formData: FormData) {
  const me = await currentHuman();
  requireRole(me.role, "supervisor", "Certifying a batch");
  const batchId = String(formData.get("batchId"));
  certifyBatch({ batchId, humanId: me.id });
  all(); revalidatePath(`/batches/${batchId}`);
  redirect(`/batches/${batchId}`);
}
export async function releaseBatchAction(formData: FormData) {
  const me = await currentHuman();
  requireRole(me.role, "finance", "Releasing a batch");
  const batchId = String(formData.get("batchId"));
  await releaseBatch({ batchId, humanId: me.id });
  generateReports();
  all(); revalidatePath(`/batches/${batchId}`);
}

// Rules are control changes: proposed from the Approver's rationale, activated by the Releaser (second person).
export async function activateRuleAction(formData: FormData) {
  const me = await currentHuman();
  requireRole(me.role, "finance", "Activating a rule");
  const proposalId = String(formData.get("proposalId"));
  const predicateRaw = String(formData.get("predicate") ?? "").trim();
  const predicate = predicateRaw ? JSON.parse(predicateRaw) : undefined;
  activateRule({ proposalId, humanId: me.id, predicate });
  all();
}
export async function rejectRuleAction(formData: FormData) {
  const me = await currentHuman();
  requireRole(me.role, "finance", "Rejecting a rule");
  rejectRule({ proposalId: String(formData.get("proposalId")), humanId: me.id });
  all();
}
export async function retireRuleAction(formData: FormData) {
  const me = await currentHuman();
  requireRole(me.role, "finance", "Retiring a rule");
  retireRule({ proposalId: String(formData.get("proposalId")), humanId: me.id, reason: String(formData.get("reason") ?? "").trim() });
  all(); revalidatePath("/today");
}

export async function newRequestAction(formData: FormData) {
  const file = formData.get("photo") as File | null;
  let imagePath: string | undefined;
  if (file && file.size > 0) {
    const dir = path.join(process.cwd(), "data", "uploads"); fs.mkdirSync(dir, { recursive: true });
    imagePath = path.join(dir, `${nanoid(8)}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`);
    fs.writeFileSync(imagePath, Buffer.from(await file.arrayBuffer()));
  }
  const d = await createRequest({
    clientId: String(formData.get("clientId")),
    category: String(formData.get("category")) as Category,
    requestedCents: Math.round(Number(formData.get("amount")) * 100),
    vendorNameRaw: String(formData.get("vendor")),
    caseNote: String(formData.get("note") ?? ""),
    rawText: String(formData.get("rawText") ?? "") || undefined,
    imagePath,
  });
  all();
  redirect(`/requests/${d.requestId}`);
}

export async function processAllAction() {
  await processAllPending();
  generateReports();
  all();
}

export async function reprocessAction(formData: FormData) {
  const id = String(formData.get("requestId"));
  await processRequest(id, { reprocess: true });
  all(); revalidatePath(`/requests/${id}`);
}

export async function reprocessManyAction(ids: string[]) {
  const me = await currentHuman();
  requireRole(me.role, "finance", "Reprocessing requests against an active rule");
  for (const id of ids) await processRequest(id, { reprocess: true });
  revalidatePath("/queue");
  revalidatePath("/today");
  revalidatePath("/rules");
  all();
}

export async function regenerateReportsAction() {
  generateReports();
  revalidatePath("/reports");
}

// Live Bright Data re-check. A timeout or failure keeps the cached record and marks it stale.
export async function recheckPublicRecordAction(formData: FormData): Promise<PublicRecord & { stale?: boolean }> {
  const requestId = String(formData.get("requestId") ?? "");
  const named = String(formData.get("vendor") ?? "").trim();
  let name = named;
  if (!name && requestId) {
    const req = db.select().from(schema.requests).where(eq(schema.requests.id, requestId)).get();
    const vendor = req?.vendorId ? db.select().from(schema.vendors).where(eq(schema.vendors.id, req.vendorId)).get() : null;
    const extracted = req ? db.select().from(schema.documents).where(eq(schema.documents.requestId, req.id)).get()?.extracted : null;
    name = vendor?.legalName ?? extracted?.vendorName?.value ?? req?.vendorNameRaw ?? "";
  }
  if (!name) return { vendorQuery: "", sfBusiness: null, web: null, fetchedAt: "", source: "MOCK", errors: ["no vendor"], stale: true };
  const cached = await vendorPublicRecord(name, { allowNetwork: false });
  const live = vendorPublicRecord(name, { force: true });
  let record: PublicRecord & { stale?: boolean };
  try {
    record = await Promise.race([
      live,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 20_000)),
    ]);
  } catch {
    live.catch(() => {});
    record = { ...cached, stale: true };
  }
  (await cookies()).set("signet_public_check", JSON.stringify({ vendor: name.toLowerCase().replace(/\s+/g, " ").trim(), stale: Boolean(record.stale) }), { path: "/", maxAge: 180, sameSite: "lax" });
  if (requestId) revalidatePath(`/requests/${requestId}`);
  revalidatePath("/integrations");
  revalidatePath("/where-did-the-50-dollars-go");
  return record;
}

export async function recheckPublicForm(formData: FormData) {
  await recheckPublicRecordAction(formData);
}

export async function resetDemoAction() {
  const result = await resetDemo();
  revalidatePath("/where-did-the-50-dollars-go");
  revalidatePath("/today");
  redirect(result.skipped ? "/where-did-the-50-dollars-go?reset=wait" : "/where-did-the-50-dollars-go");
}
