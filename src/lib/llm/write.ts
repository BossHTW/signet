// Claude Sonnet writes: a one-line case summary and, on demand, a one-paragraph defense drafted from the record.
// Output is descriptive only; approve/deny words are stripped. The decision is never influenced by this text.
import { cachedMessage, SONNET, isUnavailable } from "./client";
import type { Trigger, Allocation } from "@/db/types";

const SYSTEM = `You write for a county financial-assistance office's audit record. You describe; you never recommend.
Never use the words approve, approved, deny, denied, reject, should, recommend. State facts from the record only. No new facts.`;

export type SummaryInput = { category: string; requestedCents: number; vendorNameRaw: string; caseNote: string; extractedSummary: string; triggers: Trigger[]; allocation: Allocation[] };

export async function writeSummary(i: SummaryInput): Promise<string> {
  const fallback = fallbackSummary(i);
  const res = await cachedMessage({
    model: SONNET, max_tokens: 120, system: SYSTEM,
    messages: [{ role: "user", content: `One line, max 160 characters, for the queue card.\nRequest: ${i.category} $${(i.requestedCents / 100).toFixed(2)} to "${i.vendorNameRaw}". Case note: ${i.caseNote}\nDocument read: ${i.extractedSummary}\nChecks fired: ${i.triggers.map((t) => `${t.code}: ${t.reason}`).join(" | ") || "none"}\nAllocation: ${i.allocation.map((a) => `${a.grantId} $${(a.cents / 100).toFixed(2)}`).join(" + ") || "none"}` }],
  });
  if (isUnavailable(res)) return fallback;
  const text = res.content.find((b) => b.type === "text");
  return text && text.type === "text" ? scrub(text.text).slice(0, 160) : fallback;
}

export async function writeDefense(i: SummaryInput & { outcome: string; decidedBy: string; rationale?: string | null }): Promise<string> {
  const res = await cachedMessage({
    model: SONNET, max_tokens: 300, system: SYSTEM,
    messages: [{ role: "user", content: `One paragraph explaining this record to an auditor. Cite trigger codes. Outcome: ${i.outcome} by ${i.decidedBy}${i.rationale ? ` with rationale "${i.rationale}"` : ""}.\nRequest: ${i.category} $${(i.requestedCents / 100).toFixed(2)} to "${i.vendorNameRaw}". Case note: ${i.caseNote}\nDocument read: ${i.extractedSummary}\nChecks: ${i.triggers.map((t) => `${t.code}: ${t.reason}`).join(" | ") || "none"}\nAllocation: ${i.allocation.map((a) => `${a.grantId} $${(a.cents / 100).toFixed(2)}`).join(" + ") || "none"}` }],
  });
  if (isUnavailable(res)) return `${fallbackSummary(i)} Outcome ${i.outcome} by ${i.decidedBy}.${i.rationale ? ` Rationale: ${i.rationale}` : ""} (Drafted without the model: ${res.reason}.)`;
  const text = res.content.find((b) => b.type === "text");
  return text && text.type === "text" ? scrub(text.text) : fallbackSummary(i);
}

function scrub(s: string) { return s.replace(/\b(approve[ds]?|den(y|ied|ial)|reject(ed)?|should|recommend(ed|s)?)\b/gi, "—").replace(/\s+/g, " ").trim(); }
export function fallbackSummary(i: SummaryInput) {
  const codes = i.triggers.map((t) => t.code);
  return `${i.category} $${(i.requestedCents / 100).toFixed(2)} to ${i.vendorNameRaw}; ${codes.length ? `checks: ${codes.join(", ")}` : "all checks clear"}.`.slice(0, 160);
}
