// Memory layer: Moss semantic indexes over (a) grant clauses and (b) sealed decisions, plus vendor-alias lookup.
// LIVE: @moss-js/moss (cloud-built index, loaded in-process, ~ms queries). Fallback: a tiny local bag-of-words
// cosine index so OFFLINE/MOCK still shows precedents. Same interface either way.
import type { GrantStream } from "@/db/schema";

export type MemDoc = { id: string; text: string; metadata?: Record<string, string> };
export type MemHit = { id: string; text: string; score: number; metadata?: Record<string, string> };
export type QuerySource = "MOSS" | "LOCAL-FALLBACK" | "LOCAL";

/** Which index actually answered the most recent query. Never "MOSS" unless Moss returned the hits. */
type MemoryStats = { lastQuerySource: QuerySource; lastError: string; at: string };
declare global {
  // eslint-disable-next-line no-var
  var __signetMemoryStats: MemoryStats | undefined;
}
export const memoryStats: MemoryStats = globalThis.__signetMemoryStats ?? (globalThis.__signetMemoryStats = { lastQuerySource: "LOCAL", lastError: "", at: "" });

function noteQuery(source: QuerySource, error = "") {
  memoryStats.lastQuerySource = source;
  memoryStats.lastError = error;
  memoryStats.at = new Date().toISOString();
}

// One Moss index per project is enough (the Developer plan allows 3 per project). Documents carry metadata.kind
// ("policy" | "decision" | "vendor") and queries filter by kind client-side.
export type Kind = "policy" | "decision" | "vendor";
export const INDEX_NAME = process.env.MOSS_INDEX ?? "signet-memory";

export interface MemoryAdapter {
  readonly source: "MOSS" | "LOCAL";
  rebuild(docs: MemDoc[]): Promise<void>;
  add(docs: MemDoc[]): Promise<void>;
  query(kind: Kind, q: string, topK?: number): Promise<MemHit[]>;
  ready(): boolean;
}

// ---------------- local fallback ----------------
const tok = (s: string) => s.toLowerCase().replace(/[^a-z0-9$ ]/g, " ").split(/\s+/).filter((w) => w.length > 1);
function vec(s: string) { const m = new Map<string, number>(); for (const w of tok(s)) m.set(w, (m.get(w) ?? 0) + 1); return m; }
function cos(a: Map<string, number>, b: Map<string, number>) {
  let dot = 0, na = 0, nb = 0;
  for (const [k, v] of a) { na += v * v; const w = b.get(k); if (w) dot += v * w; }
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
class LocalMemory implements MemoryAdapter {
  readonly source = "LOCAL" as const;
  private store: { doc: MemDoc; v: Map<string, number> }[] = [];
  async rebuild(docs: MemDoc[]) { this.store = docs.map((doc) => ({ doc, v: vec(doc.text) })); }
  async add(docs: MemDoc[]) { this.store.push(...docs.map((doc) => ({ doc, v: vec(doc.text) }))); }
  async query(kind: Kind, q: string, topK = 3) {
    noteQuery("LOCAL");
    const qv = vec(q);
    return this.store.filter((e) => e.doc.metadata?.kind === kind).map((e) => ({ ...e.doc, score: cos(qv, e.v) })).filter((h) => h.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
  }
  ready() { return this.store.length > 0; }
}

// ---------------- Moss ----------------
class MossMemory implements MemoryAdapter {
  readonly source = "MOSS" as const;
  private client: import("@moss-js/moss").MossClient | null = null;
  private loaded = false;
  private local = new LocalMemory(); // mirror, so queries never fail mid-demo
  private async c() {
    if (!this.client) { const { MossClient } = await import("@moss-js/moss"); this.client = new MossClient(process.env.MOSS_PROJECT_ID!, process.env.MOSS_PROJECT_KEY!); }
    return this.client;
  }
  async rebuild(docs: MemDoc[]) {
    await this.local.rebuild(docs);
    try {
      const c = await this.c();
      try { await c.deleteIndex(INDEX_NAME); } catch { /* did not exist */ }
      await c.createIndex(INDEX_NAME, docs, { modelId: "moss-minilm" });
      await c.loadIndex(INDEX_NAME);
      this.loaded = true;
    } catch (e) { console.warn(`[moss] rebuild failed, local mirror kept: ${(e as Error).message}`); }
  }
  async add(docs: MemDoc[]) {
    await this.local.add(docs);
    try { const c = await this.c(); await c.addDocs(INDEX_NAME, docs); await c.loadIndex(INDEX_NAME); this.loaded = true; } catch (e) { console.warn(`[moss] add failed, local mirror kept: ${(e as Error).message}`); }
  }
  async query(kind: Kind, q: string, topK = 3) {
    try {
      const c = await this.c();
      if (!this.loaded) { await c.loadIndex(INDEX_NAME); this.loaded = true; }
      // over-fetch, then keep only this kind (one index, three kinds)
      const r = await c.query(INDEX_NAME, q, { topK: Math.max(topK * 6, 24), alpha: 0.7 });
      noteQuery("MOSS");
      return r.docs.filter((d) => d.metadata?.kind === kind).slice(0, topK).map((d) => ({ id: d.id, text: d.text, score: (d as { score?: number }).score ?? 0, metadata: d.metadata }));
    } catch (e) {
      const message = (e as Error).message;
      console.warn(`[moss] query failed, using local mirror: ${message}`);
      const hits = await this.local.query(kind, q, topK);
      noteQuery("LOCAL-FALLBACK", message);
      return hits;
    }
  }
  ready() { return this.loaded || this.local.ready(); }
}

declare global { // one instance per process (Next dev hot reload)
  // eslint-disable-next-line no-var
  var __signetMemory: MemoryAdapter | undefined;
  // eslint-disable-next-line no-var
  var __signetMemoryRev: number | undefined;
}
const MEMORY_REV = 3; // bump when query provenance changes so a hot reload drops the old instance
export function memory(): MemoryAdapter {
  if (!globalThis.__signetMemory || globalThis.__signetMemoryRev !== MEMORY_REV) {
    const live = Boolean(process.env.MOSS_PROJECT_ID && process.env.MOSS_PROJECT_KEY) && (process.env.MODE ?? "MOCK").toUpperCase() === "LIVE";
    globalThis.__signetMemory = live ? new MossMemory() : new LocalMemory();
    globalThis.__signetMemoryRev = MEMORY_REV;
  }
  return globalThis.__signetMemory;
}

// ---------------- document builders ----------------
export function policyDocs(grants: GrantStream[]): MemDoc[] {
  const out: MemDoc[] = [];
  for (const g of grants) {
    out.push({ id: `${g.id}-scope`, text: `${g.name} (${g.id}) from ${g.funder} funds ${g.allowedCategories.join(", ")} for clients ${elig(g)} between ${g.periodStart} and ${g.periodEnd}.`, metadata: { kind: "policy", grant: g.id, clause: "scope" } });
    out.push({ id: `${g.id}-caps`, text: `${g.id} pays at most $${(g.perInstanceCapCents / 100).toFixed(0)} per instance and $${(g.perClientPeriodCapCents / 100).toFixed(0)} per client per period. Larger amounts need a second funding source.`, metadata: { kind: "policy", grant: g.id, clause: "caps" } });
    if (g.prohibitedItems.length) out.push({ id: `${g.id}-prohibited`, text: `${g.id} prohibits paying for ${g.prohibitedItems.map((p) => p.replace(/_/g, " ")).join(", ")}. Such line items must be removed or paid from an unrestricted source.`, metadata: { kind: "policy", grant: g.id, clause: "prohibited" } });
  }
  return out;
}
const elig = (g: GrantStream) => [g.eligibility.minAge != null || g.eligibility.maxAge != null ? `aged ${g.eligibility.minAge ?? "any"}–${g.eligibility.maxAge ?? "any"}` : "of any age", g.eligibility.programs?.length ? `in programs ${g.eligibility.programs.join("/")}` : ""].filter(Boolean).join(" ");

export function decisionDoc(d: { requestId: string; category: string; requestedCents: number; vendorNameRaw: string; caseNote: string; outcome: string; decidedBy: string; rationale?: string | null; triggers: { code: string; reason: string }[] }): MemDoc {
  return {
    id: d.requestId,
    text: `${d.category} $${(d.requestedCents / 100).toFixed(2)} to ${d.vendorNameRaw}. ${d.caseNote} Flags: ${d.triggers.map((t) => `${t.code} ${t.reason}`).join("; ") || "none"}. Outcome ${d.outcome} by ${d.decidedBy}${d.rationale ? `: ${d.rationale}` : ""}.`,
    metadata: { kind: "decision", outcome: d.outcome, decidedBy: d.decidedBy, category: d.category },
  };
}
export function vendorDoc(v: { id: string; legalName: string; aliases: string[]; category: string }): MemDoc {
  return { id: v.id, text: `${v.legalName} ${v.aliases.join(" ")} ${v.category}`, metadata: { kind: "vendor", legalName: v.legalName, category: v.category } };
}
