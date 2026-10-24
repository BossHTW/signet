"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { activateRule, createRequest, humanDecide, processAllPending, processRequest, rejectRule } from "@/lib/pipeline";
import { generateReports } from "@/lib/reports";
import type { Category, TriggerCode } from "@/db/types";

const HUMAN = "finance.director"; // single approver role for the demo

export async function decideAction(formData: FormData) {
  const requestId = String(formData.get("requestId"));
  const outcome = String(formData.get("outcome")) as "APPROVED" | "DENIED";
  const rationale = String(formData.get("rationale") ?? "");
  const chosenTrigger = (formData.get("chosenTrigger") ? String(formData.get("chosenTrigger")) : undefined) as TriggerCode | undefined;
  const allocRaw = String(formData.get("allocation") ?? "").trim();
  let allocation: { grantId: string; cents: number }[] | undefined;
  if (allocRaw) {
    allocation = allocRaw.split(",").map((p) => { const [g, d] = p.split(":"); return { grantId: g.trim(), cents: Math.round(Number(d) * 100) }; }).filter((a) => a.grantId && a.cents > 0);
  }
  await humanDecide({ requestId, humanId: HUMAN, outcome, rationale, allocation, chosenTrigger });
  revalidatePath("/queue"); revalidatePath(`/requests/${requestId}`); revalidatePath("/rules"); revalidatePath("/audit");
  redirect(`/requests/${requestId}?sealed=1`);
}

export async function activateRuleAction(formData: FormData) {
  const proposalId = String(formData.get("proposalId"));
  const predicateRaw = String(formData.get("predicate") ?? "").trim();
  const predicate = predicateRaw ? JSON.parse(predicateRaw) : undefined;
  activateRule({ proposalId, humanId: HUMAN, predicate });
  revalidatePath("/rules"); revalidatePath("/audit");
}

export async function rejectRuleAction(formData: FormData) {
  rejectRule({ proposalId: String(formData.get("proposalId")), humanId: HUMAN });
  revalidatePath("/rules"); revalidatePath("/audit");
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
  revalidatePath("/queue");
  redirect(`/requests/${d.requestId}`);
}

export async function processAllAction() {
  await processAllPending();
  generateReports();
  revalidatePath("/queue"); revalidatePath("/metrics"); revalidatePath("/reports"); revalidatePath("/audit");
}

export async function reprocessAction(formData: FormData) {
  const id = String(formData.get("requestId"));
  await processRequest(id, { reprocess: true });
  revalidatePath(`/requests/${id}`); revalidatePath("/queue");
}

export async function regenerateReportsAction() {
  generateReports();
  revalidatePath("/reports");
}
