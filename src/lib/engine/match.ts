// Match Engine: vendor identity + bank reconciliation. Pure. No I/O.
import type { BankTransaction, Vendor } from "@/db/schema";
import type { Category, CrsStatus, Extracted, Trigger } from "@/db/types";
import { REQUIRES_POSTING } from "@/db/types";
import { daysBetween } from "./util";

export function normalizeVendor(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\b(LLC|INC|CORP|CO|LTD|LP|LLP|THE|OF|AND|DBA)\b/g, " ")
    .replace(/\b(MGMT|MGT)\b/g, "MANAGEMENT")
    .replace(/\bPROP\b/g, "PROPERTY")
    .replace(/\bPROPERTIES\b/g, "PROPERTY")
    .replace(/\bAPTS?\b/g, "APARTMENTS")
    .replace(/\bSVCS?\b/g, "SERVICES")
    .replace(/\b\d{1,2}\/\d{1,2}\b/g, " ") // "10/14" date fragments in bank descriptors
    .replace(/\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/g, " ") // phone numbers in descriptors
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/\s+/g, " ");
  for (let k = 0; k < t.length - 1; k++) {
    const b = t.slice(k, k + 2);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  return m;
}
export function diceBigrams(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) ?? 0);
  const total = [...A.values()].reduce((x, y) => x + y, 0) + [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / total;
}

/** 0..1 similarity on normalized names: 60% bigram Dice, 40% token overlap. */
export function similarity(a: string, b: string): number {
  const A = normalizeVendor(a), B = normalizeVendor(b);
  if (!A || !B) return 0;
  const dice = diceBigrams(A, B);
  const ta = new Set(A.split(" ")), tb = new Set(B.split(" "));
  const overlap = [...ta].filter((x) => tb.has(x)).length / Math.max(ta.size, tb.size);
  return Math.round((0.6 * dice + 0.4 * overlap) * 1000) / 1000;
}

export type CrsResult = { status: CrsStatus; riskFlags?: string[]; source: "LIVE" | "MOCK"; raw?: unknown };

export type PublicEvidence = {
  sfRegistered: boolean | null;      // null = not checked
  dbaNames: string[];                // names from the public registry (become aliases for matching)
  webPresence: boolean | null;
  source: string;
};
export type RentBenchmarkInput = { fmr1brCents: number; source: string } | null;

export type MatchInput = {
  request: { category: Category; requestedCents: number; vendorNameRaw: string; requestedAt: string };
  extracted: Extracted | null;
  vendors: Pick<Vendor, "id" | "legalName" | "aliases" | "normalizedName" | "crsStatus">[];
  bank: Pick<BankTransaction, "id" | "postedAt" | "amountCents" | "descriptor">[];
  crs: CrsResult | null;
  publicRecord?: PublicEvidence | null;
  rent?: RentBenchmarkInput;
};

export type MatchResult = {
  publicRecord: PublicEvidence | null;
  vendorId: string | null;
  vendorLegalName: string | null;
  docVendorName: string;
  vendorConfidence: number;
  bankTxnId: string | null;
  bankConfidence: number;
  crsStatus: CrsStatus;
  triggers: Trigger[];
};

const VENDOR_MIN = 0.85;
const VENDOR_CANDIDATE_MIN = 0.6;
const BANK_MIN = 0.7;
const BANK_AMOUNT_TOL = 0.02;
const BANK_WINDOW_DAYS = 45;

export function match(i: MatchInput): MatchResult {
  const t: Trigger[] = [];
  const typed = i.request.vendorNameRaw;
  const docVendor = i.extracted?.vendorName?.value ?? typed;

  // Vendor identity: best candidate over legal name + aliases, scored against both typed and document names
  const publicAliases = i.publicRecord?.dbaNames ?? [];
  const scored = i.vendors
    .map((v) => {
      // public-registry DBA names count as aliases when they resemble this vendor (alias discovery)
      const dba = publicAliases.filter((n) => similarity(n, v.legalName) >= 0.5 || similarity(n, typed) >= 0.5);
      const names = [v.legalName, ...(v.aliases ?? []), ...dba];
      const s = Math.max(...names.flatMap((n) => [similarity(n, typed), similarity(n, docVendor)]));
      return { v, s };
    })
    .sort((a, b) => b.s - a.s);
  const best = scored[0];
  const vendor = best && best.s >= VENDOR_CANDIDATE_MIN ? best.v : null;

  // Disagreement between what the CM typed and what the document says is itself a signal
  const typedVsDoc = similarity(typed, docVendor);
  let vendorConfidence = 0;
  if (vendor) {
    // If the document name matches an alias/legal name strongly, trust that even if the typed name was sloppy
    const docScore = Math.max(...[vendor.legalName, ...(vendor.aliases ?? []), ...publicAliases].map((n) => similarity(n, docVendor)));
    vendorConfidence = Math.round(Math.max(docScore, Math.min(best.s, 0.5 + 0.5 * typedVsDoc)) * 1000) / 1000;
  }
  if (vendorConfidence < VENDOR_MIN) {
    t.push({
      code: "MATCH-LOW",
      reason: `Vendor on document ("${docVendor}") does not clearly match "${typed}"${vendor ? ` or known vendor "${vendor.legalName}"` : ""} (${Math.round(vendorConfidence * 100)}%).`,
      evidence: { docVendor, typed, candidate: vendor?.legalName ?? null, score: vendorConfidence },
    });
  }

  // Bank reconciliation: posting within ±2% of amount and the window, descriptor resembling the vendor
  const amt = i.extracted?.amountCents?.value ?? i.request.requestedCents;
  const target = vendor?.legalName ?? docVendor;
  const cands = i.bank
    .filter((b) => Math.abs(b.amountCents - amt) <= Math.max(1, amt * BANK_AMOUNT_TOL) && daysBetween(b.postedAt, i.request.requestedAt) <= BANK_WINDOW_DAYS)
    .map((b) => ({ b, s: Math.max(similarity(b.descriptor, target), ...(vendor?.aliases ?? []).map((a) => similarity(b.descriptor, a))) }))
    .sort((a, b) => b.s - a.s);
  const top = cands[0];
  const bankTxn = top && top.s >= 0.5 ? top.b : null;
  const bankConfidence = bankTxn ? Math.round((0.5 + 0.5 * top.s) * 1000) / 1000 : 0;
  if (REQUIRES_POSTING.has(i.request.category) && bankConfidence < BANK_MIN) {
    t.push({
      code: "BANK-LOW",
      reason: `No bank posting matches this ${i.request.category} invoice (best ${Math.round(bankConfidence * 100)}%).`,
      evidence: { amount: amt, candidates: cands.slice(0, 3).map((c) => ({ id: c.b.id, descriptor: c.b.descriptor, score: c.s })) },
    });
  }

  // CRS vendor identity
  const crsStatus: CrsStatus = i.crs?.status ?? vendor?.crsStatus ?? "UNKNOWN";
  if (crsStatus === "FLAGGED" || crsStatus === "UNVERIFIED") {
    t.push({
      code: "VENDOR-FLAG",
      reason: `Vendor identity check returned ${crsStatus}${i.crs?.riskFlags?.length ? ` (${i.crs.riskFlags.join(", ")})` : ""}.`,
      evidence: { crsStatus, riskFlags: i.crs?.riskFlags ?? [] },
    });
  }

  // Public record: a landlord or new vendor with no SF registration and no web presence is worth a look
  const pr = i.publicRecord ?? null;
  if (pr && pr.sfRegistered === false && pr.webPresence === false && (i.request.category === "rent" || i.request.category === "deposit" || !vendor)) {
    t.push({ code: "PUBLIC-NONE", reason: `No San Francisco business registration or web presence found for "${vendor?.legalName ?? docVendor}" (${pr.source}).`, evidence: { source: pr.source } });
  }
  // Rent reasonableness against HUD fair market rent (1-bedroom); partial payments are fine, full rents above 125% of FMR get a look
  if (i.rent && i.request.category === "rent" && i.request.requestedCents > i.rent.fmr1brCents * 1.25) {
    t.push({ code: "RENT-HIGH", reason: `$${(i.request.requestedCents / 100).toFixed(0)} exceeds 125% of the 1-bedroom fair market rent ($${(i.rent.fmr1brCents / 100).toFixed(0)}, ${i.rent.source}).`, evidence: { fmr1brCents: i.rent.fmr1brCents } });
  }

  return {
    publicRecord: pr,
    vendorId: vendor?.id ?? null,
    vendorLegalName: vendor?.legalName ?? null,
    docVendorName: docVendor,
    vendorConfidence,
    bankTxnId: bankTxn?.id ?? null,
    bankConfidence,
    crsStatus,
    triggers: t,
  };
}
