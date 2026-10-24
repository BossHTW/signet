import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { Seal } from "@/components/Seal";
import { TriggerChip } from "@/components/TriggerChip";
import { Money, money } from "@/components/Money";
import { decideAction, reprocessAction } from "@/app/actions";
import type { Extracted, Field } from "@/db/types";
import { DefenseButton } from "./defense";

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sealed?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const r = db.select().from(schema.requests).where(eq(schema.requests.id, id)).get();
  if (!r) notFound();
  const d = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, id)).get();
  const c = db.select().from(schema.clients).where(eq(schema.clients.id, r.clientId)).get()!;
  const docs = db.select().from(schema.documents).where(eq(schema.documents.requestId, id)).all();
  const grants = db.select().from(schema.grantStreams).all();
  const proposal = d ? db.select().from(schema.ruleProposals).where(eq(schema.ruleProposals.sourceDecisionId, d.id)).get() : null;
  const ext = docs[0]?.extracted ?? null;
  const pr = (d?.policyResult ?? {}) as { eligibleGrants?: string[]; clientAgeYears?: number };
  const mr = (d?.matchResult ?? {}) as { vendorConfidence?: number; bankConfidence?: number; crsStatus?: string; vendorLegalName?: string | null; docVendorName?: string; bankTxnId?: string | null };
  const canDecide = d && d.decidedBy === "SYSTEM" && d.outcome === "ESCALATED";

  return (
    <div className="grid gap-5">
      <div className="flex items-start gap-4">
        <div className="grid gap-2">
          <div className="kicker"><Link href="/queue" className="underline underline-offset-4">Queue</Link> &nbsp;/&nbsp; <span className="mono normal-case tracking-normal">{r.id}</span> &nbsp;/&nbsp; {r.status}</div>
          <h1 className="display" style={{ fontSize: 64 }}><Money cents={r.requestedCents} /> <span style={{ color: "var(--yellow-ink)" }}>{r.category}</span></h1>
          <div className="serif text-lg">to <b>{r.vendorNameRaw}</b> for <b>{c.displayName}</b> <span style={{ color: "var(--ink2)" }}>(age {pr.clientAgeYears ?? "?"}, {c.programs.join("/")}) · requested {r.requestedAt} by {r.caseManagerId}</span></div>
          <div className="serif italic" style={{ color: "var(--ink2)" }}>“{r.caseNote}”</div>
        </div>
        {d && <div className="ml-auto">{sp.sealed && <div className="kicker text-center mb-1" style={{ color: "var(--seal)" }}>sealed</div>}<Seal seal={d.seal} outcome={d.outcome} /></div>}
      </div>

      {!d && <form action={reprocessAction}><input type="hidden" name="requestId" value={r.id} /><button className="btn btn-primary">Run the agent on this request</button></form>}

      <div className="grid md:grid-cols-3 gap-4">
        {/* LEFT: the document */}
        <section className="card p-5 grid gap-3 content-start">
          <div className="kicker">Document <span className="normal-case tracking-normal font-normal" style={{ color: "var(--clay)" }}>· {docs[0]?.kind} · read by {docs[0]?.model ?? "—"}</span></div>
          {docs[0]?.imagePath && <img alt="document" src={`/api/doc-image?id=${docs[0].id}`} className="rounded-lg border" style={{ borderColor: "var(--line)" }} />}
          <pre className="mono text-xs whitespace-pre-wrap p-4 rounded-xl" style={{ background: "var(--concrete)", maxHeight: 360, overflow: "auto" }}>{docs[0]?.rawText ?? "(image only)"}</pre>
          <div className="mono text-[10px]" style={{ color: "var(--clay)" }}>sha256 {docs[0]?.sourceHash.slice(0, 20)}…</div>
        </section>

        {/* MIDDLE: what Claude read */}
        <section className="card p-5 grid gap-3 content-start">
          <div className="kicker">What the agent read <span className="normal-case tracking-normal font-normal" style={{ color: "var(--clay)" }}>· confidence per field · yellow needs a human eye</span></div>
          {!ext && <div className="serif italic" style={{ color: "var(--ink2)" }}>Not read yet.</div>}
          {ext && <ExtractedView ext={ext} />}
          <p className="serif italic text-sm mt-2" style={{ color: "var(--ink2)" }}>Claude only reads. The checks and the decision are code.</p>
        </section>

        {/* RIGHT: the two checks */}
        <section className="card p-5 grid gap-4">
          <div className="kicker">Two independent checks</div>
          <div>
            <div className="display-std text-lg">Grant policy <span className="serif italic font-normal text-sm" style={{ color: "var(--clay)" }}>code</span></div>
            <div className="text-sm">Eligible: {pr.eligibleGrants?.length ? pr.eligibleGrants.join(", ") : <span style={{ color: "var(--seal)" }}>none</span>}</div>
            <div className="text-sm">Allocation: {d?.allocation.length ? d.allocation.map((a) => `${a.grantId} ${money(a.cents)}`).join(" + ") : "—"}</div>
          </div>
          <div>
            <div className="display-std text-lg">Vendor &amp; bank match <span className="serif italic font-normal text-sm" style={{ color: "var(--clay)" }}>code{mr.crsStatus ? " + CRS" : ""}</span></div>
            <div className="text-sm">Vendor: {mr.vendorLegalName ?? <i>no confident match</i>} · <span className="mono">{Math.round((mr.vendorConfidence ?? 0) * 100)}%</span></div>
            <div className="text-sm">Document says: “{mr.docVendorName}”</div>
            <div className="text-sm">Bank posting: {mr.bankTxnId ? <span className="mono">{mr.bankTxnId}</span> : <i>none</i>} · <span className="mono">{Math.round((mr.bankConfidence ?? 0) * 100)}%</span></div>
            <div className="text-sm">CRS identity: <b>{mr.crsStatus ?? "—"}</b></div>
          </div>
          <div>
            <div className="display-std text-lg mb-1">Why it {d?.decidedBy === "SYSTEM" && d.outcome === "APPROVED" ? "was paid automatically" : "came to a person"}</div>
            <div>{d?.triggers.length ? d.triggers.map((t, i) => <TriggerChip key={i} t={t} withReason />) : <span className="chip chip-ok">all checks clear · within limit</span>}</div>
          </div>
          {d?.caseSummary && <div className="serif text-sm p-3 rounded-xl" style={{ background: "var(--concrete)" }}><span className="kicker mb-1" style={{ fontSize: ".65rem", display: "block" }}>agent summary</span>{d.caseSummary}</div>}
          {d && <DefenseButton requestId={r.id} />}
        </section>
      </div>

      {/* HUMAN DECISION */}
      {canDecide && (
        <section className="slab p-7 grid gap-4">
          <div><div className="display text-4xl" style={{ color: "var(--yellow)" }}>Your decision.</div><div className="serif italic" style={{ color: "var(--clay)" }}>A rationale is required. It becomes a proposed rule.</div></div>
          <form action={decideAction} className="grid gap-3">
            <input type="hidden" name="requestId" value={r.id} />
            <div className="grid md:grid-cols-2 gap-3">
              <div><label>Rationale</label><textarea name="rationale" rows={3} required placeholder="e.g. Same receipt filed for two clients; refer to supervisor." /></div>
              <div className="grid gap-2">
                <div><label>Which flag are you resolving?</label>
                  <select name="chosenTrigger" defaultValue={d.triggers[0]?.code}>{d.triggers.map((t, i) => <option key={i} value={t.code}>{t.code} — {t.reason.slice(0, 70)}</option>)}</select></div>
                <div><label>Allocation override (optional) — GRANT:dollars, comma-separated</label>
                  <input name="allocation" placeholder={d.allocation.map((a) => `${a.grantId}:${(a.cents / 100).toFixed(2)}`).join(", ") || "e.g. EUSG:177.00"} />
                  <div className="text-[11px] mt-1 ui" style={{ color: "var(--clay)" }}>Grants: {grants.map((g) => `${g.id} (cap ${money(g.perInstanceCapCents)})`).join(" · ")}</div></div>
              </div>
            </div>
            <div className="flex gap-3">
              <button name="outcome" value="APPROVED" className="btn btn-yellow">Approve &amp; seal</button>
              <button name="outcome" value="DENIED" className="btn btn-seal">Deny &amp; seal</button>
              <span className="serif italic text-sm self-center" style={{ color: "var(--clay)" }}>Only a person can deny. The agent never does.</span>
            </div>
          </form>
        </section>
      )}

      {d?.decidedBy === "HUMAN" && (
        <section className="card p-5 grid gap-3">
          <div className="flex items-center gap-4"><Seal seal={d.seal} outcome={d.outcome} size={64} /><div><div className="display-std text-xl">Sealed by {d.humanId}</div><div className="serif italic" style={{ color: "var(--ink2)" }}>“{d.rationale}”</div></div></div>
          {proposal && <div className="serif">Proposed rule from this decision: <Link href="/rules" className="underline">{proposal.status === "ACTIVE" ? "active" : proposal.status.toLowerCase()} → review on Rules</Link>{proposal.replayImpact && <> · would have changed <b>{proposal.replayImpact.wouldChange}</b> past decision{proposal.replayImpact.wouldChange === 1 ? "" : "s"}</>}</div>}
        </section>
      )}
    </div>
  );
}

function ExtractedView({ ext }: { ext: Extracted }) {
  const rows: [string, Field<unknown> | undefined, (v: unknown) => string][] = [
    ["Vendor", ext.vendorName, String],
    ["Amount", ext.amountCents, (v) => money(v as number)],
    ["Date", ext.date, String],
    ["Name on doc", ext.clientNameOnDoc, String],
  ];
  return (
    <div className="grid gap-1.5">
      {rows.filter(([, f]) => f).map(([label, f, fmt]) => (
        <div key={label} className={`field grid gap-0.5 ${f!.confidence < 0.8 ? "field-low" : ""}`}>
          <div className="flex justify-between kicker" style={{ fontSize: ".65rem" }}><span>{label}</span><span className="mono normal-case">{Math.round(f!.confidence * 100)}%</span></div>
          <div className="display-std text-xl">{fmt(f!.value)}</div>
          {f!.evidence && <div className="mono text-[11px]" style={{ color: "var(--clay)" }}>“{f!.evidence}”</div>}
        </div>
      ))}
      {ext.lineItems && (
        <div className={`field ${ext.lineItems.confidence < 0.8 ? "field-low" : ""}`}>
          <div className="flex justify-between kicker" style={{ fontSize: ".65rem" }}><span>Line items</span><span className="mono normal-case">{Math.round(ext.lineItems.confidence * 100)}%</span></div>
          {ext.lineItems.value.map((l, i) => (
            <div key={i} className="flex justify-between text-sm"><span>{l.label} {l.flag && l.flag !== "other" && <span className={`chip ${l.flag === "late_fee" || l.flag === "reconnection_penalty" || l.flag === "device_purchase" || l.flag === "gift_card" ? "chip-hard" : "chip-grey"}`} style={{ fontSize: ".6rem" }}>{l.flag}</span>}</span><span className="mono">{money(l.cents)}</span></div>
          ))}
        </div>
      )}
      {ext.notes && <div className="serif italic text-sm" style={{ color: "var(--ink2)" }}>{ext.notes}</div>}
    </div>
  );
}
