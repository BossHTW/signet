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

/** One short plain-English paragraph for a supervisor who is not technical. Built from the structured explanation; null when the model is unavailable. */
export async function writeExplanation(i: { headline: string; flags: { title: string; saw: string; rule: { cite: string; text: string } | null; precedent: { text: string; outcome: string } | null; look: string }[]; clean: string[]; category: string; requestedCents: number; vendorNameRaw: string; caseNote: string }): Promise<string | null> {
  if (!i.flags.length) return null;
  const res = await cachedMessage({
    model: SONNET, max_tokens: 260,
    system: `You explain a financial-assistance record to a program supervisor who is not technical and has thirty seconds. Plain words, no codes, no jargon, no percentages. Describe what was found, what rule it comes from, and what to look at. Never use the words approve, approved, deny, denied, reject, should, recommend. No new facts.`,
    messages: [{ role: "user", content: `Request: ${i.category} $${(i.requestedCents / 100).toFixed(2)} to "${i.vendorNameRaw}". Case note: ${i.caseNote}\n${i.headline}\n${i.flags.map((f, n) => `${n + 1}. ${f.title}. Seen: ${f.saw}${f.rule ? ` Rule: ${f.rule.cite}: ${f.rule.text}` : ""}${f.precedent ? ` A supervisor once handled a similar case (${f.precedent.outcome}): ${f.precedent.text}` : ""} Look at: ${f.look}`).join("\n")}\nWhat passed: ${i.clean.join(" ")}\nWrite one paragraph, 60–110 words.` }],
  });
  if (isUnavailable(res)) return null;
  const text = res.content.find((b) => b.type === "text");
  return text && text.type === "text" ? scrub(text.text) : null;
}
