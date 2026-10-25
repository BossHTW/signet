// Plain language first, audit codes second. Every code the engines emit has a title a supervisor would say out loud,
// one line on what it means, and what to look at. Codes stay visible (small, mono) because auditors search by them.
import type { TriggerCode } from "@/db/types";

export const TRIGGER: Record<TriggerCode, { title: string; means: string; look: string; hard: boolean }> = {
  "POL-HARD":   { title: "Not allowed by the grant",        means: "The funding rules do not cover this: the client is outside eligibility, the item is prohibited, or the date is outside the grant period.", look: "The grant clause named in the reason; whether another funding source could pay instead.", hard: true },
  "LIMIT-OVER": { title: "Above the batch limit",           means: "Clean on every check, but larger than the amount this category can go through a sampled batch. A person opens it.", look: "The amount against the document; whether it is a one-time or recurring need.", hard: false },
  "SPLIT-REQ":  { title: "Needs two funding sources",       means: "No single grant can cover the full amount within its caps, so the system proposed a split.", look: "The proposed split; whether the second source is appropriate for this client.", hard: false },
  "DUP-HIT":    { title: "Possible duplicate",              means: "The same document, or the same vendor and amount, was already submitted within 45 days.", look: "The earlier request it matched; whether both are legitimate (two clients, same plan) or one is a repeat.", hard: true },
  "AMT-DIFF":   { title: "Amount doesn't match the document", means: "The amount requested differs from the amount the document shows.", look: "The document total and the request; whether the difference is a fee, a partial payment, or a typo.", hard: false },
  "EXTRACT-LOW": { title: "Document hard to read",          means: "A field the reader needed came back unclear or missing.", look: "The highlighted fields; read them off the document yourself.", hard: false },
  "MATCH-LOW":  { title: "Vendor name doesn't match records", means: "The payee on the document is not a confident match to any vendor on file.", look: "The document's payee name against the vendor list; a DBA or a new landlord is common.", hard: false },
  "BANK-LOW":   { title: "No matching bank payment",        means: "Reimbursement categories need a prior payment in the bank feed, and none matched this vendor and amount.", look: "The bank feed for the client's payment; the posting descriptor may use a short code.", hard: false },
  "VENDOR-FLAG": { title: "Vendor flagged by credit check", means: "The vendor identity check returned a risk flag.", look: "The flag text; verify the vendor by phone or registry before any payment.", hard: true },
  "RULE-ESC":   { title: "Flagged by a rule your team set", means: "A rule a supervisor wrote and finance activated matched this request.", look: "The rule's rationale on the Rules page.", hard: false },
  "PUBLIC-NONE": { title: "No public record of this business", means: "No San Francisco business registration and no web presence was found for this payee.", look: "Whether this is a private landlord (common, fine) or a business that should be registered.", hard: false },
  "RENT-HIGH":  { title: "Rent above market benchmark",     means: "The rent is more than 125% of HUD's fair market rent for a one-bedroom in San Francisco.", look: "Unit size and location; whether the lease supports the amount.", hard: false },
};

export const OUTCOME_WORD: Record<string, string> = { READY: "Verified", ESCALATED: "Needs a person", APPROVED: "Certified", DENIED: "Denied", RELEASED: "Paid", NEW: "New", PROCESSING: "Reading" };

/** Confidence as words. The percentage stays available as a tooltip for people who want it. */
export function confidenceWord(c: number) {
  if (c >= 0.9) return { word: "Read clearly", low: false };
  if (c >= 0.8) return { word: "Fairly sure", low: false };
  return { word: "Check this", low: true };
}

export const FIELD_LABEL: Record<string, string> = {
  vendorName: "Paid to",
  amountCents: "Amount on the document",
  date: "Document date",
  clientNameOnDoc: "Whose name is on it",
  lineItems: "What it is for",
};
