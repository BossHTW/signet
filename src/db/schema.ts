import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import type {
  Category, Eligibility, Extracted, Trigger, Allocation, Seal, AuditType, Predicate,
  RuleAction, RuleStatus, ReportRow, Outcome, RequestStatus, SealKind, CrsStatus, Program, BatchStatus,
} from "./types";

export const caseManagers = sqliteTable("case_managers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
});

export const clients = sqliteTable("clients", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  dob: text("dob").notNull(),
  programs: text("programs", { mode: "json" }).$type<Program[]>().notNull(),
  caseManagerId: text("case_manager_id").notNull(),
});

export const grantStreams = sqliteTable("grant_streams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  funder: text("funder").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  totalCents: integer("total_cents").notNull(),
  spentCents: integer("spent_cents").notNull().default(0),
  allowedCategories: text("allowed_categories", { mode: "json" }).$type<Category[]>().notNull(),
  prohibitedItems: text("prohibited_items", { mode: "json" }).$type<string[]>().notNull(),
  perInstanceCapCents: integer("per_instance_cap_cents").notNull(),
  perClientPeriodCapCents: integer("per_client_period_cap_cents").notNull(),
  eligibility: text("eligibility", { mode: "json" }).$type<Eligibility>().notNull(),
  priority: integer("priority").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
});

export const vendors = sqliteTable("vendors", {
  id: text("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  aliases: text("aliases", { mode: "json" }).$type<string[]>().notNull().default([]),
  category: text("category").$type<Category>().notNull(),
  crsTestIdentityId: text("crs_test_identity_id"),
  crsStatus: text("crs_status").$type<CrsStatus>().notNull().default("UNKNOWN"),
  nessieAccountId: text("nessie_account_id"),
});

export const requests = sqliteTable("requests", {
  id: text("id").primaryKey(),
  clientId: text("client_id").notNull(),
  caseManagerId: text("case_manager_id").notNull(),
  category: text("category").$type<Category>().notNull(),
  requestedCents: integer("requested_cents").notNull(),
  vendorId: text("vendor_id"),
  vendorNameRaw: text("vendor_name_raw").notNull(),
  caseNote: text("case_note").notNull(),
  requestedAt: text("requested_at").notNull(),
  status: text("status").$type<RequestStatus>().notNull().default("NEW"),
  plantedAnomaly: text("planted_anomaly"),
}, (t) => [index("req_client").on(t.clientId), index("req_status").on(t.status)]);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  kind: text("kind").$type<"receipt" | "lease" | "utility_bill" | "invoice" | "photo">().notNull(),
  sourceHash: text("source_hash").notNull(),
  rawText: text("raw_text"),
  imagePath: text("image_path"),
  extracted: text("extracted", { mode: "json" }).$type<Extracted>(),
  extractedAt: text("extracted_at"),
  model: text("model"),
}, (t) => [index("doc_request").on(t.requestId), index("doc_hash").on(t.sourceHash)]);

export const bankTransactions = sqliteTable("bank_transactions", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  postedAt: text("posted_at").notNull(),
  amountCents: integer("amount_cents").notNull(),
  descriptor: text("descriptor").notNull(),
  counterpartyNormalized: text("counterparty_normalized").notNull(),
  source: text("source").$type<"NESSIE" | "MOCK">().notNull(),
});

export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull().unique(),
  outcome: text("outcome").$type<Outcome>().notNull(),
  decidedBy: text("decided_by").$type<SealKind>().notNull(),
  humanId: text("human_id"),
  rationale: text("rationale"),
  triggers: text("triggers", { mode: "json" }).$type<Trigger[]>().notNull(),
  allocation: text("allocation", { mode: "json" }).$type<Allocation[]>().notNull(),
  limitsApplied: text("limits_applied", { mode: "json" }).$type<Record<string, number>>().notNull(),
  policyResult: text("policy_result", { mode: "json" }).notNull(),
  matchResult: text("match_result", { mode: "json" }).notNull(),
  caseSummary: text("case_summary"),
  seal: text("seal", { mode: "json" }).$type<Seal>().notNull(),
  decidedAt: text("decided_at").notNull(),
  decisionMs: integer("decision_ms").notNull(),
  batchId: text("batch_id"),
});

// A release batch: opened by the Approver over READY + human-APPROVED items, certified after the sample is attested, released by a different person.
export const releaseBatches = sqliteTable("release_batches", {
  id: text("id").primaryKey(),
  status: text("status").$type<BatchStatus>().notNull().default("OPEN"),
  itemIds: text("item_ids", { mode: "json" }).$type<string[]>().notNull(),
  sampleIds: text("sample_ids", { mode: "json" }).$type<string[]>().notNull(),
  attestedIds: text("attested_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
  totalCents: integer("total_cents").notNull(),
  openedBy: text("opened_by").notNull(),
  openedAt: text("opened_at").notNull(),
  certifiedBy: text("certified_by"),
  certifiedAt: text("certified_at"),
  releasedBy: text("released_by"),
  releasedAt: text("released_at"),
});
export type ReleaseBatch = typeof releaseBatches.$inferSelect;

export const auditEvents = sqliteTable("audit_events", {
  seq: integer("seq").primaryKey({ autoIncrement: true }),
  at: text("at").notNull(),
  requestId: text("request_id"),
  type: text("type").$type<AuditType>().notNull(),
  actor: text("actor").notNull(),
  payload: text("payload", { mode: "json" }).notNull(),
  prevHash: text("prev_hash").notNull(),
  hash: text("hash").notNull(),
});

export const ruleProposals = sqliteTable("rule_proposals", {
  id: text("id").primaryKey(),
  sourceDecisionId: text("source_decision_id").notNull(),
  rationale: text("rationale").notNull(),
  predicate: text("predicate", { mode: "json" }).$type<Predicate>().notNull(),
  action: text("action").$type<RuleAction>().notNull(),
  status: text("status").$type<RuleStatus>().notNull().default("PROPOSED"),
  replayImpact: text("replay_impact", { mode: "json" }).$type<{ matched: number; wouldChange: number; ids: string[] }>(),
  createdAt: text("created_at").notNull(),
  activatedAt: text("activated_at"),
  activatedBy: text("activated_by"),
});

export const complianceReports = sqliteTable("compliance_reports", {
  id: text("id").primaryKey(),
  grantId: text("grant_id").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  rows: text("rows", { mode: "json" }).$type<ReportRow[]>().notNull(),
  totals: text("totals", { mode: "json" }).$type<{ cents: number; count: number; escalated: number; denied: number }>().notNull(),
  generatedAt: text("generated_at").notNull(),
});

export type CaseManager = typeof caseManagers.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type GrantStream = typeof grantStreams.$inferSelect;
export type Vendor = typeof vendors.$inferSelect;
export type Request = typeof requests.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type BankTransaction = typeof bankTransactions.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type RuleProposal = typeof ruleProposals.$inferSelect;
export type ComplianceReport = typeof complianceReports.$inferSelect;
