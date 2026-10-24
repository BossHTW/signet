// The only writer to audit_events. Append-only, hash-chained.
import { createHash } from "node:crypto";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db/client";
import type { AuditType } from "@/db/types";

const GENESIS = "0".repeat(64);

export function hashEvent(prevHash: string, at: string, type: string, payload: unknown): string {
  return createHash("sha256").update(prevHash + "|" + at + "|" + type + "|" + JSON.stringify(payload)).digest("hex");
}

export function appendAudit(args: { type: AuditType; actor: string; requestId?: string | null; payload: unknown; at?: string }) {
  const last = db.select({ hash: schema.auditEvents.hash }).from(schema.auditEvents).orderBy(desc(schema.auditEvents.seq)).limit(1).get();
  const prevHash = last?.hash ?? GENESIS;
  const at = args.at ?? new Date().toISOString();
  const hash = hashEvent(prevHash, at, args.type, args.payload);
  db.insert(schema.auditEvents).values({ at, type: args.type, actor: args.actor, requestId: args.requestId ?? null, payload: args.payload as object, prevHash, hash }).run();
  return hash;
}

/** Recomputes every hash in sequence. Returns the first broken seq, or null if the chain verifies. */
export function verifyChain(): { ok: boolean; count: number; brokenAt: number | null } {
  const rows = db.select().from(schema.auditEvents).orderBy(schema.auditEvents.seq).all();
  let prev = GENESIS;
  for (const r of rows) {
    if (r.prevHash !== prev) return { ok: false, count: rows.length, brokenAt: r.seq };
    if (hashEvent(prev, r.at, r.type, r.payload) !== r.hash) return { ok: false, count: rows.length, brokenAt: r.seq };
    prev = r.hash;
  }
  return { ok: true, count: rows.length, brokenAt: null };
}
