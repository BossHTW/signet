import fs from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { desc, eq, isNotNull } from "drizzle-orm";
import { isAfter, parseISO } from "date-fns";
import { db, schema } from "@/db/client";
import { currentMode } from "@/lib/adapters/types";
import { type MemHit, type QuerySource } from "@/lib/adapters/memory";
import { precedents } from "@/lib/pipeline";
import { NessieInspect } from "@/components/NessieInspect";
import { money } from "@/components/Money";
import { publicCheckLabel } from "@/lib/adapters/public";
import { recheckPublicForm } from "@/app/actions";
import type { Extracted, Field } from "@/db/types";

type PaymentTxn = { txnId?: string; accountId?: string; raw?: { objectCreated?: unknown } };
type PaymentPayload = { txns?: PaymentTxn[]; source?: string };
type PublicFile = {
  vendorQuery?: string;
  sfBusiness?: { found?: boolean; count?: number; dbaNames?: string[]; source?: string } | null;
  web?: { found?: boolean; source?: string; results?: unknown[] } | null;
  source?: string;
  fetchedAt?: string;
};
type CrsShape = {
  status?: string; source?: string; riskFlags?: string[]; raw?: unknown; persona?: string;
};
type MatchShape = {
  crs?: CrsShape; crsStatus?: string; vendorId?: string | null; vendorLegalName?: string | null;
  riskFlags?: string[]; source?: "LIVE" | "MOCK"; crsSource?: "LIVE" | "MOCK"; raw?: unknown;
};

function StatusChip({ live }: { live: boolean }) {
  return (
    <span className="chip chip-grey shrink-0">
      <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: live ? "var(--ok)" : "var(--ink-3)" }} aria-label={live ? "live" : "fallback"} />
      {live ? "Live" : "Fallback"}
    </span>
  );
}

function ProofCard({ title, does, live, children, raw, inspect }: { title: string; does: string; live: boolean; children: React.ReactNode; raw?: unknown; inspect: string }) {
  return (
    <section className="card p-5 grid gap-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="font-medium">{title}</h2>
          <p className="text-sm muted mt-0.5">{does}</p>
        </div>
        <span className="ml-auto"><StatusChip live={live} /></span>
      </div>
      {children}
      {raw != null && <NessieInspect raw={raw} label={inspect} />}
    </section>
  );
}

const none = <p className="text-sm faint">No evidence yet.</p>;

function fieldText(label: string, field: Field<string> | Field<number> | undefined, asMoney = false) {
  if (!field) return null;
  const shown = asMoney && typeof field.value === "number" ? money(field.value) : String(field.value);
  return <div key={label} className="text-sm">{label}: <b>{shown}</b> <span className="faint">· {Math.round(field.confidence * 100)}% confident</span></div>;
}

function claudeDoc(): { model: string | null; extracted: Extracted } | null {
  try {
    const doc = db.select().from(schema.documents).where(isNotNull(schema.documents.extracted)).orderBy(desc(schema.documents.extractedAt)).limit(1).get();
    if (!doc?.extracted) return null;
    return { model: doc.model, extracted: doc.extracted };
  } catch { return null; }
}

function nessieLive(): boolean {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "nessie.json"), "utf8")) as { accountId?: string };
    return Boolean(j.accountId);
  } catch { return false; }
}

function nessiePayment(): { txns: PaymentTxn[]; source?: string; raw: unknown } | null {
  try {
    const ev = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "PAYMENT_SENT")).orderBy(desc(schema.auditEvents.seq)).limit(1).get();
    if (!ev) return null;
    const payload = ev.payload as PaymentPayload;
    const txns = payload.txns ?? [];
    const raws = txns.map((t) => t.raw?.objectCreated ?? t.raw).filter((r) => r != null);
    return { txns, source: payload.source, raw: raws.length === 1 ? raws[0] : raws.length ? raws : null };
  } catch { return null; }
}

function brightRecord(): { count: number; rec: PublicFile | null } {
  try {
    const dir = path.join(process.cwd(), "data", "cache", "public");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    let best: PublicFile | null = null;
    for (const file of files) {
      try {
        const rec = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as PublicFile;
        if (!best) { best = rec; continue; }
        const at = rec.fetchedAt ? parseISO(rec.fetchedAt) : null;
        const prev = best.fetchedAt ? parseISO(best.fetchedAt) : null;
        if (at && (!prev || isAfter(at, prev))) best = rec;
      } catch { /* one bad cache file does not blank the card */ }
    }
    return { count: files.length, rec: best };
  } catch { return { count: 0, rec: null }; }
}

async function mossSample(): Promise<{ source: QuerySource; error: string; hits: MemHit[]; ok: boolean }> {
  try {
    const row = db.select({ id: schema.decisions.requestId }).from(schema.decisions).orderBy(desc(schema.decisions.decidedAt)).limit(1).get();
    if (!row) return { source: "LOCAL", error: "", hits: [], ok: false };
    const found = await precedents(row.id);
    const hits = [...found.decisions, ...found.clauses, ...found.vendors].slice(0, 4);
    return { source: found.source, error: found.error, hits, ok: true };
  } catch { return { source: "LOCAL", error: "", hits: [], ok: false }; }
}

function brightRequestId(vendorQuery: string | undefined): string {
  if (!vendorQuery) return "";
  try {
    const vendor = db.select().from(schema.vendors).all().find((v) => v.legalName === vendorQuery);
    if (!vendor) return "";
    return db.select({ id: schema.requests.id }).from(schema.requests).where(eq(schema.requests.vendorId, vendor.id)).get()?.id ?? "";
  } catch { return ""; }
}

function personaFor(requestId: string, vendorId: string | null | undefined): string | null {
  try {
    const req = db.select({ vendorId: schema.requests.vendorId }).from(schema.requests).where(eq(schema.requests.id, requestId)).get();
    const id = req?.vendorId ?? vendorId ?? "";
    if (!id) return null;
    return db.select().from(schema.vendors).where(eq(schema.vendors.id, id)).get()?.crsTestIdentityId ?? null;
  } catch { return null; }
}

type CrsCard = { status: string; source: string | null; riskFlags: string[]; persona: string | null; vendor: string | null; raw: unknown };

function crsEvidence(): CrsCard | null {
  try {
    const rows = db.select().from(schema.decisions).orderBy(desc(schema.decisions.decidedAt)).all();
    for (const d of rows) {
      const mr = d.matchResult as MatchShape;
      const crs = mr.crs;
      if (!crs || !(crs.status || crs.source || crs.riskFlags?.length || crs.raw != null)) continue;
      return {
        status: crs.status ?? mr.crsStatus ?? "UNKNOWN",
        source: crs.source ?? null,
        riskFlags: crs.riskFlags ?? [],
        persona: crs.persona ?? personaFor(d.requestId, mr.vendorId),
        vendor: mr.vendorLegalName ?? null,
        raw: crs.raw ?? null,
      };
    }
    let plain: CrsCard | null = null;
    let withPersona: CrsCard | null = null;
    let withFlags: CrsCard | null = null;
    for (const d of rows) {
      const mr = d.matchResult as MatchShape;
      if (!mr.crsStatus) continue;
      const fromTrigger = d.triggers.find((t) => t.code === "VENDOR-FLAG")?.evidence?.riskFlags;
      const riskFlags = mr.riskFlags ?? (Array.isArray(fromTrigger) ? fromTrigger.filter((f): f is string => typeof f === "string") : []);
      const persona = personaFor(d.requestId, mr.vendorId);
      const card: CrsCard = { status: mr.crsStatus, source: mr.source ?? mr.crsSource ?? null, riskFlags, persona, vendor: mr.vendorLegalName ?? null, raw: mr.raw ?? null };
      plain ??= card;
      if (persona) withPersona ??= card;
      if (persona && riskFlags.length) withFlags ??= card;
    }
    // Newest FraudFinder persona that actually recorded flags; else the newest persona; else the newest status.
    return withFlags ?? withPersona ?? plain;
  } catch { return null; }
}

export default async function IntegrationsPage() {
  const mode = currentMode();
  const doc = claudeDoc();
  const pay = nessiePayment();
  const pub = brightRecord();
  const moss = await mossSample();
  const crs = crsEvidence();
  const sf = pub.rec?.sfBusiness;
  const web = pub.rec?.web;
  const publicMark = publicCheckLabel(pub.rec?.fetchedAt, (await cookies()).get("signet_public_check")?.value, pub.rec?.vendorQuery ?? "");
  const brightRequest = brightRequestId(pub.rec?.vendorQuery);

  return (
    <div className="grid gap-6">
      <div>
        <div className="kicker mb-2">Proof</div>
        <h1 className="display-std text-[28px]">Integrations</h1>
        <p className="muted mt-2 max-w-3xl">Each card is one sponsor API. Open the drawer to see the last real call this database recorded.</p>
      </div>

      <ProofCard title="Claude" does="Haiku reads a document into fields. Sonnet writes a one-line summary. Neither one decides." live={mode === "LIVE" && Boolean(process.env.ANTHROPIC_API_KEY)} inspect="Inspect extracted fields" raw={doc?.extracted}>
        {doc ? (
          <div className="grid gap-1">
            <div className="text-sm">Model <span className="mono">{doc.model ?? "unknown"}</span></div>
            {fieldText("Vendor", doc.extracted.vendorName)}
            {fieldText("Amount", doc.extracted.amountCents, true)}
            {fieldText("Date", doc.extracted.date)}
          </div>
        ) : none}
      </ProofCard>

      <ProofCard title="Capital One Nessie" does="Operating-account feed, and the withdrawal that releases a certified payment." live={nessieLive()} inspect="Inspect Nessie response" raw={pay?.raw}>
        {pay ? (
          <div className="grid gap-1 text-sm">
            <div>Transactions <span className="mono">{pay.txns.map((t) => t.txnId).filter(Boolean).join(", ") || "—"}</span></div>
            <div>Account <span className="mono">{pay.txns.find((t) => t.accountId)?.accountId ?? "—"}</span></div>
            <div>Source <span className="mono">{pay.source ?? "—"}</span></div>
          </div>
        ) : none}
      </ProofCard>

      <ProofCard title="Bright Data" does="San Francisco business registry and public web presence, cached so the demo replays offline." live={Boolean(process.env.BRIGHTDATA_API_TOKEN)} inspect="Inspect public record" raw={pub.rec}>
        {pub.rec ? (
          <div className="grid gap-1 text-sm">
            <div>Query <b>{pub.rec.vendorQuery ?? "—"}</b></div>
            <div>SF registry: <b>{sf?.found == null ? "not checked" : sf.found ? `found (${sf.count ?? 0})` : "not found"}</b>{sf?.dbaNames?.length ? <span className="faint"> · {sf.dbaNames.slice(0, 3).join(", ")}</span> : null}</div>
            <div>Web: <b>{web?.found == null ? "not checked" : web.found ? "found" : "none"}</b>{web?.source ? <span className="faint"> · {web.source}</span> : null}</div>
            <div>Source <span className="mono">{pub.rec.source ?? "—"}</span> · <span title={publicMark.stale ? "The live re-check timed out. This is the cached record." : undefined}>{publicMark.text}</span></div>
            <div className="faint">{pub.count} cached record{pub.count === 1 ? "" : "s"}</div>
            <form action={recheckPublicForm} className="mt-1">
              <input type="hidden" name="requestId" value={brightRequest} />
              <input type="hidden" name="vendor" value={pub.rec.vendorQuery ?? ""} />
              <button className="btn" style={{ minHeight: 28, fontSize: 13 }}>Re-check live</button>
            </form>
          </div>
        ) : none}
      </ProofCard>

      <ProofCard title="Moss" does="Semantic memory over precedents, grant clauses, and vendor aliases." live={moss.source === "MOSS"} inspect="Inspect memory hits" raw={moss.ok && moss.hits.length ? moss.hits : undefined}>
        {moss.ok ? (
          <div className="grid gap-2">
            <div className="text-sm">Index <span className="mono" title={moss.source === "LOCAL-FALLBACK" ? moss.error : undefined} style={moss.source === "LOCAL-FALLBACK" ? { color: "var(--ink-3)" } : undefined}>{moss.source}</span></div>
            {moss.hits.length === 0 && <p className="text-sm faint">The sample query returned no hits.</p>}
            {moss.hits.map((h) => (
              <div key={h.id} className="text-sm">
                <span className="mono faint">{h.metadata?.kind ?? "hit"} · {h.score.toFixed(2)}</span>
                <div>{h.text.length > 180 ? `${h.text.slice(0, 180)}…` : h.text}</div>
              </div>
            ))}
          </div>
        ) : none}
      </ProofCard>

      <ProofCard title="CRS" does="StitchCredit FraudFinder on a sandbox persona. A flagged vendor is a reason to look, never an automatic denial." live={mode === "LIVE" && Boolean(process.env.CRS_API_USERNAME && process.env.CRS_API_PASSWORD)} inspect="Inspect CRS response" raw={crs?.raw}>
        {crs ? (
          <div className="grid gap-1 text-sm">
            <div>Status <b>{crs.status}</b>{crs.vendor ? <> · {crs.vendor}</> : null}</div>
            <div>Source <span className="mono">{crs.source ?? "not stored on the decision"}</span></div>
            <div>Flags {crs.riskFlags.length ? crs.riskFlags.join(", ") : <span className="faint">none recorded</span>}</div>
            <div>Persona <span className="mono">{crs.persona ?? "—"}</span></div>
          </div>
        ) : none}
      </ProofCard>
    </div>
  );
}
