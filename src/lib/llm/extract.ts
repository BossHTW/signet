// Claude Haiku reads a document (OCR text or image) into Extracted with per-field confidence.
// This is the ONLY place the model reads documents. It never decides anything.
import fs from "node:fs";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { cachedMessage, HAIKU, isUnavailable } from "./client";
import type { Extracted, LineItemFlag } from "@/db/types";

const Field = <T extends z.ZodTypeAny>(v: T) => z.object({ value: v, confidence: z.number().min(0).max(1), evidence: z.string().optional() });
const FLAGS = ["late_fee", "reconnection_penalty", "device_purchase", "gift_card", "deposit", "tax", "other"] as const;
export const ExtractedSchema = z.object({
  vendorName: Field(z.string()).optional(),
  amountCents: Field(z.number().int()).optional(),
  date: Field(z.string()).optional(),
  lineItems: Field(z.array(z.object({ label: z.string(), cents: z.number().int(), flag: z.enum(FLAGS).optional() }))).optional(),
  clientNameOnDoc: Field(z.string()).optional(),
  address: Field(z.string()).optional(),
  docType: Field(z.string()).optional(),
  notes: z.string().optional(),
});

const TOOL: Anthropic.Tool = {
  name: "record_extraction",
  description: "Record the fields read from the document with a 0-1 confidence for each. Use null/omit when a field is absent.",
  input_schema: {
    type: "object",
    properties: {
      vendorName: { type: "object", properties: { value: { type: "string" }, confidence: { type: "number" }, evidence: { type: "string" } }, required: ["value", "confidence"] },
      amountCents: { type: "object", properties: { value: { type: "integer", description: "TOTAL amount due in integer cents" }, confidence: { type: "number" }, evidence: { type: "string" } }, required: ["value", "confidence"] },
      date: { type: "object", properties: { value: { type: "string", description: "ISO date YYYY-MM-DD" }, confidence: { type: "number" }, evidence: { type: "string" } }, required: ["value", "confidence"] },
      lineItems: { type: "object", properties: { value: { type: "array", items: { type: "object", properties: { label: { type: "string" }, cents: { type: "integer" }, flag: { type: "string", enum: [...FLAGS] } }, required: ["label", "cents"] } }, confidence: { type: "number" } }, required: ["value", "confidence"] },
      clientNameOnDoc: { type: "object", properties: { value: { type: "string" }, confidence: { type: "number" } }, required: ["value", "confidence"] },
      address: { type: "object", properties: { value: { type: "string" }, confidence: { type: "number" } }, required: ["value", "confidence"] },
      docType: { type: "object", properties: { value: { type: "string", enum: ["receipt", "lease", "utility_bill", "invoice", "other"] }, confidence: { type: "number" } }, required: ["value", "confidence"] },
      notes: { type: "string", description: "Anything unusual, in one sentence." },
    },
  },
};

const SYSTEM = `You read documents for a county financial-assistance office. You extract fields; you do not judge, recommend, approve or deny.
Rules:
- Amounts are integer cents. "$405.00" → 40500. If the OCR dropped a decimal ("$40500" on a utility bill), infer the plausible value and LOWER your confidence.
- Flag line items precisely: late fees / late payment charges → late_fee; reconnection or restoration penalties → reconnection_penalty; handsets or equipment → device_purchase; gift cards → gift_card; security deposits → deposit; taxes → tax; everything else → other.
- Confidence is YOUR honest probability the value is exactly right. Below 0.8 means a human should look.
- evidence is the short quoted span you read the value from.
- If text is truncated or illegible, say so in notes and lower confidence. Never invent a vendor or an amount.`;

export type ExtractInput = { rawText?: string | null; imagePath?: string | null; hint?: { category: string; vendorNameRaw: string } };

export async function extractDocument(i: ExtractInput): Promise<{ extracted: Extracted | null; model: string; reason?: string }> {
  const content: Anthropic.ContentBlockParam[] = [];
  if (i.imagePath && fs.existsSync(i.imagePath)) {
    const bytes = fs.readFileSync(i.imagePath);
    const mt = i.imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    content.push({ type: "image", source: { type: "base64", media_type: mt, data: bytes.toString("base64") } });
  }
  content.push({ type: "text", text: `Case manager says this is a ${i.hint?.category ?? "document"} from "${i.hint?.vendorNameRaw ?? "unknown vendor"}".\n\nDocument text (may be OCR):\n"""\n${i.rawText ?? "(image only)"}\n"""\nRecord the extraction.` });

  const run = () => cachedMessage({ model: HAIKU, max_tokens: 1024, system: SYSTEM, tools: [TOOL], tool_choice: { type: "tool", name: "record_extraction" }, messages: [{ role: "user", content }] });

  let res = await run();
  if (isUnavailable(res)) return { extracted: null, model: HAIKU, reason: res.reason };
  let parsed = parseTool(res);
  if (!parsed.success) { // one retry, then give up → pipeline raises EXTRACT-LOW
    res = await run();
    if (isUnavailable(res)) return { extracted: null, model: HAIKU, reason: res.reason };
    parsed = parseTool(res);
  }
  if (!parsed.success) return { extracted: null, model: HAIKU, reason: "schema failure" };
  return { extracted: parsed.data as Extracted, model: HAIKU };
}

function parseTool(res: Anthropic.Message) {
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") return { success: false as const };
  const r = ExtractedSchema.safeParse(block.input);
  return r.success ? { success: true as const, data: r.data } : { success: false as const };
}

/** MOCK/OFFLINE extractor for seeded requests: perfect read with a little deterministic noise, so no key is needed to demo. */
export function truthExtractor(truth: { vendorName: string; amountCents: number; date: string; lineItems: { label: string; cents: number; flag?: LineItemFlag }[]; clientNameOnDoc?: string }, noiseLevel: number): Extracted {
  const c = Math.max(0.81, 0.97 - noiseLevel * 0.05);
  return {
    vendorName: { value: truth.vendorName, confidence: c, evidence: truth.vendorName },
    amountCents: { value: truth.amountCents, confidence: noiseLevel >= 3 ? 0.78 : c, evidence: `$${(truth.amountCents / 100).toFixed(2)}` },
    date: { value: truth.date, confidence: c },
    lineItems: { value: truth.lineItems, confidence: c },
    ...(truth.clientNameOnDoc ? { clientNameOnDoc: { value: truth.clientNameOnDoc, confidence: c } } : {}),
    docType: { value: "receipt", confidence: 0.9 },
  };
}

/** Heuristic fallback for a brand-new typed request when the model is unavailable (judge at the table, Wi-Fi down). */
export function heuristicExtractor(rawText: string, vendorNameRaw: string): Extracted {
  const amts = [...rawText.matchAll(/\$\s?(\d{1,6})(?:\.(\d{2}))?/g)].map((m) => Number(m[1]) * 100 + Number(m[2] ?? 0));
  const total = amts.length ? Math.max(...amts) : undefined;
  const lateLine = rawText.split("\n").find((l) => /late (payment )?(fee|charge)|late fee/i.test(l));
  const lateAmt = lateLine ? [...lateLine.matchAll(/\$\s?(\d{1,6})(?:\.(\d{2}))?/g)].map((m) => Number(m[1]) * 100 + Number(m[2] ?? 0))[0] ?? 0 : 0;
  const lineItems = total ? [{ label: "Total", cents: total }, ...(lateLine ? [{ label: lateLine.replace(/\$.*$/, "").trim() || "Late payment charge", cents: lateAmt, flag: "late_fee" as const }] : [])] : [];
  return {
    vendorName: { value: vendorNameRaw, confidence: 0.6, evidence: "typed by case manager" },
    ...(total ? { amountCents: { value: total, confidence: 0.6 } } : {}),
    lineItems: { value: lineItems, confidence: 0.5 },
    notes: "heuristic extraction (model unavailable)",
  };
}
