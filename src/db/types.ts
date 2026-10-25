// Shared domain types. Money is always integer cents. Dates are ISO strings (YYYY-MM-DD).

export type Category = "rent" | "deposit" | "utilities" | "phone" | "transit" | "documents";
export const CATEGORIES: Category[] = ["rent", "deposit", "utilities", "phone", "transit", "documents"];

export type Program = "TAY" | "EDU" | "FAMILY" | "FOSTER";
export type Eligibility = { minAge?: number; maxAge?: number; programs?: Program[] };

export type LineItemFlag = "late_fee" | "reconnection_penalty" | "device_purchase" | "gift_card" | "deposit" | "tax" | "other";

export type Field<T> = { value: T; confidence: number; evidence?: string };
export type LineItem = { label: string; cents: number; flag?: LineItemFlag };
export type Extracted = {
  vendorName?: Field<string>;
  amountCents?: Field<number>;
  date?: Field<string>;
  lineItems?: Field<LineItem[]>;
  clientNameOnDoc?: Field<string>;
  address?: Field<string>;
  docType?: Field<string>;
  notes?: string;
};

export type TriggerCode =
  | "POL-HARD" | "LIMIT-OVER" | "SPLIT-REQ" | "DUP-HIT" | "AMT-DIFF"
  | "EXTRACT-LOW" | "MATCH-LOW" | "BANK-LOW" | "VENDOR-FLAG" | "RULE-ESC" | "PUBLIC-NONE" | "RENT-HIGH";
export type Trigger = { code: TriggerCode; reason: string; evidence?: Record<string, unknown> };

export type Allocation = { grantId: string; cents: number };
export type SealKind = "SYSTEM" | "HUMAN";
export type Seal = { kind: SealKind; at: string; by: string; hash: string };

// System outcomes: READY (verified, batch-eligible) or ESCALATED (needs a person). Human outcomes: APPROVED (certified) or DENIED.
// There is no code path from the system to APPROVED, DENIED or a payment.
export type Outcome = "READY" | "ESCALATED" | "APPROVED" | "DENIED";
export const SYSTEM_OUTCOMES = ["READY", "ESCALATED"] as const;
export type RequestStatus = "NEW" | "PROCESSING" | "READY" | "ESCALATED" | "APPROVED" | "DENIED" | "RELEASED";
export type BatchStatus = "OPEN" | "CERTIFIED" | "RELEASED";
// Two named humans, segregated (GAO Green Book ¶10.12; GAO B-302789): the Approver certifies, the Releaser moves money.
export type Role = "supervisor" | "finance";
export const ROLES: Record<Role, { id: string; title: string; may: string }> = {
  supervisor: { id: "program.supervisor", title: "Program Supervisor (Approver)", may: "decide escalations, certify batches" },
  finance: { id: "finance.director", title: "Finance Director (Releaser)", may: "release certified batches, activate rules" },
};
// Batch certification: the Approver must open and attest a random sample before certifying the batch (Green Book OV4.14).
export const SAMPLE_RATE = 0.10;
export const SAMPLE_MIN = 3;
// Items at or above this amount are never batch-sampled: they are always opened individually by the Approver (dual control).
export const DUAL_CONTROL_CENTS = 200_000;
export type Mode = "LIVE" | "MOCK" | "OFFLINE";
export type CrsStatus = "VERIFIED" | "FLAGGED" | "UNVERIFIED" | "UNKNOWN";

export type AuditType =
  | "REQUEST_CREATED" | "DOC_EXTRACTED" | "CHECKS_RUN" | "VERIFIED_READY" | "ESCALATED"
  | "HUMAN_DECIDED" | "BATCH_OPENED" | "ITEM_ATTESTED" | "BATCH_CERTIFIED" | "BATCH_RELEASED" | "PAYMENT_SENT" | "RULE_PROPOSED" | "RULE_ACTIVATED" | "RULE_REJECTED" | "RULE_RETIRED"
  | "REPORT_GENERATED" | "MODE_CHANGED";

// ---- Rule DSL (intentionally tiny) ----
export const FIELD_PATHS = [
  "request.category", "request.requestedCents", "request.vendorNameRaw", "request.clientAgeYears",
  "extracted.lineItems.flags", "extracted.amountCents",
  "match.vendorConfidence", "match.bankConfidence",
  "vendor.crsStatus", "vendor.normalizedName", "grant.id", "history.sameVendor45dCount", "history.sameVendorAmount45dCount",
] as const;
export type FieldPath = (typeof FIELD_PATHS)[number];
export const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "matches"] as const;
export type Op = (typeof OPS)[number];
export type Predicate =
  | { all: Predicate[] } | { any: Predicate[] } | { not: Predicate }
  | { field: FieldPath; op: Op; value: unknown };
export type RuleAction = "escalate" | "flag" | "allow_within_limit";
export type RuleStatus = "PROPOSED" | "ACTIVE" | "REJECTED" | "RETIRED";

export type ReportRow = {
  requestId: string; clientId: string; category: Category; cents: number;
  decidedBy: SealKind; outcome: Outcome; triggers: TriggerCode[]; sealHash: string;
};

export type Metrics = {
  processed: number; readyPct: number; escalatedPct: number; deniedPct: number;
  certified: number; released: number; attested: number; autonomousPayments: 0;
  medianDecisionMs: number; anomaliesPlanted: number; anomaliesCaught: number;
  caughtByCode: Partial<Record<TriggerCode, number>>; staffHoursSavedPer100: number;
  llmCalls: number; llmCacheHits: number; spendUsd: number; mode: Mode;
};

// Default per-category batch limits (cents): below this a clean request is READY for batch certification; above it a person opens it. A human can change these later.
export const DEFAULT_LIMITS: Record<Category, number> = {
  rent: 80_000, deposit: 100_000, utilities: 30_000, phone: 12_000, transit: 10_000, documents: 7_500,
};
// Categories where a prior bank posting is expected before paying (invoice-style)
export const REQUIRES_POSTING = new Set<Category>(["rent", "utilities"]);
// Fields that must be read confidently per category
export const REQUIRED_FIELDS: Record<Category, (keyof Extracted)[]> = {
  rent: ["vendorName", "amountCents"], deposit: ["vendorName", "amountCents"],
  utilities: ["vendorName", "amountCents", "lineItems"], phone: ["vendorName", "amountCents", "lineItems"],
  transit: ["amountCents"], documents: ["amountCents"],
};
