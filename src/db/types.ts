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
  | "EXTRACT-LOW" | "MATCH-LOW" | "BANK-LOW" | "VENDOR-FLAG" | "RULE-ESC";
export type Trigger = { code: TriggerCode; reason: string; evidence?: Record<string, unknown> };

export type Allocation = { grantId: string; cents: number };
export type SealKind = "SYSTEM" | "HUMAN";
export type Seal = { kind: SealKind; at: string; by: string; hash: string };

export type Outcome = "APPROVED" | "ESCALATED" | "DENIED";
export type RequestStatus = "NEW" | "PROCESSING" | "APPROVED" | "ESCALATED" | "DENIED" | "DISBURSED";
export type Mode = "LIVE" | "MOCK" | "OFFLINE";
export type CrsStatus = "VERIFIED" | "FLAGGED" | "UNVERIFIED" | "UNKNOWN";

export type AuditType =
  | "REQUEST_CREATED" | "DOC_EXTRACTED" | "CHECKS_RUN" | "AUTO_APPROVED" | "ESCALATED"
  | "HUMAN_DECIDED" | "DISBURSED" | "RULE_PROPOSED" | "RULE_ACTIVATED" | "RULE_REJECTED"
  | "REPORT_GENERATED" | "MODE_CHANGED";

// ---- Rule DSL (intentionally tiny) ----
export type FieldPath =
  | "request.category" | "request.requestedCents" | "request.vendorNameRaw" | "request.clientAgeYears"
  | "extracted.lineItems.flags" | "extracted.amountCents"
  | "match.vendorConfidence" | "match.bankConfidence"
  | "vendor.crsStatus" | "vendor.normalizedName" | "grant.id" | "history.sameVendor45dCount";
export type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "matches";
export type Predicate =
  | { all: Predicate[] } | { any: Predicate[] } | { not: Predicate }
  | { field: FieldPath; op: Op; value: unknown };
export type RuleAction = "escalate" | "flag" | "allow_within_limit";
export type RuleStatus = "PROPOSED" | "ACTIVE" | "REJECTED";

export type ReportRow = {
  requestId: string; clientId: string; category: Category; cents: number;
  decidedBy: SealKind; outcome: Outcome; triggers: TriggerCode[]; sealHash: string;
};

export type Metrics = {
  processed: number; autoApprovedPct: number; escalatedPct: number; deniedPct: number;
  medianDecisionMs: number; anomaliesPlanted: number; anomaliesCaught: number;
  caughtByCode: Partial<Record<TriggerCode, number>>; staffHoursSavedPer100: number;
  llmCalls: number; llmCacheHits: number; spendUsd: number; mode: Mode;
};

// Default per-category auto-approve limits (cents). A human can change these in settings later.
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
