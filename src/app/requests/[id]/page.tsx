import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { Seal } from "@/components/Seal";
import { TriggerChip } from "@/components/TriggerChip";
import { Money, money } from "@/components/Money";
import { NessieInspect } from "@/components/NessieInspect";
import { cookies } from "next/headers";
import { attestAction, decideAction, recheckPublicForm, reprocessAction } from "@/app/actions";
import { publicCheckLabel, vendorPublicRecord } from "@/lib/adapters/public";
import { currentHuman } from "@/lib/role";
import { DUAL_CONTROL_CENTS } from "@/db/types";
import type { Extracted, Field } from "@/db/types";
import { confidenceWord, FIELD_LABEL, OUTCOME_WORD } from "@/lib/labels";
import { DefenseButton } from "./defense";
import { Precedents } from "./precedents";

export default async function RequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sealed?: string; batch?: string }> }) {
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
  const pubRec = ((d?.matchResult ?? {}) as { publicRecord?: { sfRegistered: boolean | null; dbaNames: string[]; webPresence: boolean | null; source: string } | null }).publicRecord ?? null;
  const mr = (d?.matchResult ?? {}) as {
    vendorConfidence?: number; bankConfidence?: number; crsStatus?: string; vendorLegalName?: string | null;
    docVendorName?: string; bankTxnId?: string | null; source?: "LIVE" | "MOCK"; crsSource?: "LIVE" | "MOCK";
    riskFlags?: string[]; raw?: unknown;
  };
  const me = await currentHuman();
  const vendorRow = r.vendorId ? db.select().from(schema.vendors).where(eq(schema.vendors.id, r.vendorId)).get() : null;
  const publicName = vendorRow?.legalName ?? docs[0]?.extracted?.vendorName?.value ?? r.vendorNameRaw;
  const publicCached = await vendorPublicRecord(publicName, { allowNetwork: false }).catch(() => null);
  const cachedPub = publicCached?.source === "CACHE" ? publicCached : null;
  const sfRegistered = cachedPub ? cachedPub.sfBusiness?.found ?? null : pubRec?.sfRegistered ?? null;
  const dbaNames = cachedPub ? cachedPub.sfBusiness?.dbaNames ?? [] : pubRec?.dbaNames ?? [];
  const webPresence = cachedPub ? cachedPub.web?.found ?? null : pubRec?.webPresence ?? null;
  const webSource = cachedPub ? cachedPub.web?.source ?? cachedPub.source : pubRec?.source;
  const publicMark = publicCheckLabel(publicCached?.source === "CACHE" ? publicCached.fetchedAt : undefined, (await cookies()).get("signet_public_check")?.value, publicName);
  const canDecide = d && d.decidedBy === "SYSTEM" && d.outcome === "ESCALATED";
  const batch = d?.batchId ? db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.id, d.batchId)).get() : null;
  const sampled = Boolean(batch && batch.status === "OPEN" && batch.sampleIds.includes(r.id));
  const attested = Boolean(batch && batch.attestedIds.includes(r.id));
  const statusLine: Record<string, string> = { READY: "verified · waiting for a release batch", APPROVED: "certified · waiting for release", RELEASED: "paid", ESCALATED: "needs a person", DENIED: "denied by a person", NEW: "new", PROCESSING: "reading" };

  return (
    <div className="grid gap-5">
      <div className="flex items-start gap-4">
        <div className="grid gap-2">
          <div className="kicker"><Link href="/queue" className="underline underline-offset-4">Requests</Link> &nbsp;/&nbsp; <span className="mono normal-case tracking-normal">{r.id}</span> &nbsp;/&nbsp; {(statusLine[r.status] ?? OUTCOME_WORD[r.status] ?? r.status)}{batch && <> &nbsp;/&nbsp; <Link href={`/batches/${batch.id}`} className="underline underline-offset-4 normal-case tracking-normal mono">{batch.id}</Link></>}</div>
          <h1 className="display-std text-[28px]"><span className="num">{money(r.requestedCents)}</span> <span>{r.category}</span></h1>
          <div className="muted">to <b>{r.vendorNameRaw}</b> for <b>{c.displayName}</b> <span style={{ color: "var(--ink-2)" }}>(age {pr.clientAgeYears ?? "?"}, {c.programs.join("/")}) · requested {r.requestedAt} by {r.caseManagerId}</span></div>
          <div className="text-sm muted" style={{ color: "var(--ink-2)" }}>“{r.caseNote}”</div>
        </div>
        {d && <div className="ml-auto"><div className={sp.sealed ? "seal-pressed" : ""}><Seal seal={d.seal} outcome={d.outcome} status={r.status} /></div></div>}
      </div>

      {!d && <form action={reprocessAction}><input type="hidden" name="requestId" value={r.id} /><button className="btn btn-primary">Run the agent on this request</button></form>}
      {d && d.decidedBy === "SYSTEM" && d.outcome === "ESCALATED" && (
        <form action={reprocessAction}><input type="hidden" name="requestId" value={r.id} /><button className="btn">Reprocess against active rules</button></form>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        {/* LEFT: the document */}
        <section className="card p-5 grid gap-3 content-start">
          <h2 className="kicker">The document <span className="normal-case tracking-normal font-normal faint">· {docs[0]?.kind} · read by {docs[0]?.model === "truth-extractor" ? "Claude (cached)" : docs[0]?.model ?? "—"}</span></h2>
          {docs[0]?.imagePath && <img alt="document" src={`/api/doc-image?id=${docs[0].id}`} className="rounded-lg border" style={{ borderColor: "var(--line)" }} />}
          <pre className="mono text-xs whitespace-pre-wrap p-4 rounded-xl" style={{ background: "var(--paper)", maxHeight: 360, overflow: "auto" }}>{docs[0]?.rawText ?? "(image only)"}</pre>
          <div className="mono text-[10px]" style={{ color: "var(--ink-3)" }}>sha256 {docs[0]?.sourceHash.slice(0, 20)}…</div>
        </section>

        {/* MIDDLE: what Claude read */}
        <section className="card p-5 grid gap-3 content-start">
          <h2 className="kicker">What the agent read <span className="normal-case tracking-normal font-normal faint">· amber means read it yourself</span></h2>
          {!ext && <div className="text-sm muted" style={{ color: "var(--ink-2)" }}>Not read yet.</div>}
          {ext && <ExtractedView ext={ext} />}
          <p className="text-xs muted mt-2">Claude only reads the document. The checks are code; the decision is two segregated people: a Certifier, then a Releaser.</p>
        </section>

        {/* RIGHT: the two checks */}
        <section className="card p-5 grid gap-4">
          <h2 className="kicker">Two independent checks</h2>
          <div>
            <div className="font-semibold">Funding rules <span className="font-normal text-xs faint">· checked by code</span></div>
            <div className="text-sm">Eligible funding: {pr.eligibleGrants?.length ? pr.eligibleGrants.join(", ") : <span className="muted">none</span>}</div>
            <div className="text-sm">Paid from: {d?.allocation.length ? d.allocation.map((a) => `${a.grantId} ${money(a.cents)}`).join(" + ") : "—"}</div>
          </div>
          <div>
            <div className="font-semibold">Who gets paid <span className="font-normal text-xs faint">· checked by code{mr.crsStatus ? " and a credit-bureau identity check" : ""}</span></div>
            <div className="text-sm">On our vendor list as: {mr.vendorLegalName ?? <i>no confident match</i>} <span className="text-xs faint" title={`${Math.round((mr.vendorConfidence ?? 0) * 100)}% match`}>· {confidenceWord(mr.vendorConfidence ?? 0).word.toLowerCase()}</span></div>
            <div className="text-sm">The document says: “{mr.docVendorName}”</div>
            <div className="text-sm">Matching bank payment: {mr.bankTxnId ? <span className="mono">{mr.bankTxnId}</span> : <i>none found</i>}{mr.bankTxnId && <span className="text-xs faint" title={`${Math.round((mr.bankConfidence ?? 0) * 100)}% match`}> · {confidenceWord(mr.bankConfidence ?? 0).word.toLowerCase()}</span>}</div>
            <div className="text-sm">Identity check: <b>{({ VERIFIED: "verified", FLAGGED: "flagged", UNVERIFIED: "could not verify", UNKNOWN: "not run" } as Record<string, string>)[mr.crsStatus ?? "UNKNOWN"]}</b>
              {(mr.source ?? mr.crsSource) && <span className="text-xs faint"> · {(mr.source ?? mr.crsSource) === "LIVE" ? "live" : "test"}</span>}
            </div>
            {mr.riskFlags && mr.riskFlags.length > 0 && <div className="text-sm muted">Flags: {mr.riskFlags.join(", ")}</div>}
            {mr.raw != null && <NessieInspect raw={mr.raw} label="Inspect CRS response" />}
            {pubRec && (
              <div className="text-sm mt-1 pt-1" style={{ borderTop: "1px solid var(--line)" }}>
                <span className="kicker" style={{ fontSize: ".62rem" }}>Public record</span>
                <div>SF business registry: <b>{sfRegistered == null ? "not checked" : sfRegistered ? "registered" : "not found"}</b>{dbaNames.length ? <span style={{ color: "var(--ink-2)" }}> · DBA {dbaNames.slice(0, 2).join(", ")}</span> : null}</div>
                <div>Web presence: <b>{webPresence == null ? "not checked" : webPresence ? "found" : "none"}</b> <span className="text-xs" style={{ color: "var(--ink-3)" }}>· {webSource}</span></div>
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  <span className="text-xs" style={{ color: "var(--ink-3)" }} title={publicMark.stale ? "The live re-check timed out. This is the cached record." : undefined}>{publicMark.text}</span>
                  <form action={recheckPublicForm}><input type="hidden" name="requestId" value={r.id} /><button className="btn" style={{ minHeight: 28, fontSize: 13 }}>Re-check live</button></form>
                </div>
              </div>
            )}
          </div>
          <div>
            <div className="font-semibold mb-1">{d?.outcome === "READY" || (d?.rationale ?? "").startsWith("Certified in batch") ? "Why it is batch-eligible" : "Why it came to a person"}</div>
            <div>{d?.triggers.length ? d.triggers.map((t, i) => <TriggerChip key={i} t={t} withReason />) : <span className="chip chip-ok">Every check passed · under the batch limit · one funding source</span>}</div>
          </div>
          {d?.caseSummary && <div className="text-sm p-3 rounded-xl" style={{ background: "var(--paper)" }}><span className="kicker mb-1" style={{ fontSize: ".65rem", display: "block" }}>in one line</span>{d.caseSummary}</div>}
          {d && <DefenseButton requestId={r.id} />}
        </section>
      </div>

      {d && <Precedents requestId={r.id} />}

      {/* ATTESTATION (sampled item in an open batch) */}
      {sampled && (
        <section className="slab p-7 grid md:grid-cols-[1fr_auto] gap-5 items-center">
          <div>
            <div className="display-std text-xl">{attested ? "You attested this record." : r.requestedCents >= DUAL_CONTROL_CENTS ? "Dual control: read this one in full." : "Sampled for batch " + batch!.id + "."}</div>
            <div className="mt-1" style={{ color: "var(--ink-3)" }}>Read the document, the fields the agent extracted, and both checks above. Attesting records your name and the statement “I opened this record, read the document and the checks, and certify the facts recited.”</div>
          </div>
          {!attested && me.role === "supervisor" && (
            <form action={attestAction}><input type="hidden" name="batchId" value={batch!.id} /><input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="back" value={`/batches/${batch!.id}`} />
              <button className="btn btn-primary btn-lg">Attest &amp; back to batch</button></form>
          )}
          {!attested && me.role !== "supervisor" && <div className="text-sm muted" style={{ color: "var(--ink-3)" }}>Only the Program Supervisor attests.</div>}
        </section>
      )}

      {/* HUMAN DECISION */}
      {canDecide && me.role !== "supervisor" && (
        <section className="card p-5 muted">This escalation is decided by the Program Supervisor. Switch role in the header to decide it.</section>
      )}
      {canDecide && me.role === "supervisor" && (
        <section className="slab p-7 grid gap-4">
          <div><div className="display-std text-2xl">Your decision.</div><div className="text-sm muted" style={{ color: "var(--ink-3)" }}>A rationale is required. It becomes a proposed rule for the Finance Director to activate. Approving certifies the item; money still waits for a release.</div></div>
          <form action={decideAction} className="grid gap-3">
            <input type="hidden" name="requestId" value={r.id} />
            <div className="grid md:grid-cols-2 gap-3">
              <div><label>Rationale</label><textarea name="rationale" rows={3} required placeholder="e.g. Same receipt filed for two clients; refer to supervisor." /></div>
              <div className="grid gap-2">
                <div><label>Which flag are you resolving?</label>
                  <select name="chosenTrigger" defaultValue={d.triggers[0]?.code}>{d.triggers.map((t, i) => <option key={i} value={t.code}>{t.code} — {t.reason.slice(0, 70)}</option>)}</select></div>
                <div><label>Allocation override (optional) — GRANT:dollars, comma-separated</label>
                  <input name="allocation" placeholder={d.allocation.map((a) => `${a.grantId}:${(a.cents / 100).toFixed(2)}`).join(", ") || "e.g. EUSG:177.00"} />
                  <div className="text-[11px] mt-1 ui" style={{ color: "var(--ink-3)" }}>Grants: {grants.map((g) => `${g.id} (cap ${money(g.perInstanceCapCents)})`).join(" · ")}</div></div>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 items-center">
              <button name="outcome" value="APPROVED" className="btn btn-primary btn-lg">Approve &amp; certify</button>
              <button name="outcome" value="DENIED" className="btn btn-seal btn-lg">Deny &amp; seal</button>
              <span className="text-[13px] muted">Only a person approves or denies. The agent never does either.</span>
            </div>
          </form>
        </section>
      )}

      {d?.decidedBy === "HUMAN" && (
        <section className="card p-5 grid gap-3">
          <div className="flex items-center gap-4"><Seal seal={d.seal} outcome={d.outcome} status={r.status} size={64} /><div><div className="display-std text-xl">{r.status === "RELEASED" ? "Paid" : d.outcome === "DENIED" ? "Denied" : "Certified"} by {d.humanId}{batch?.releasedBy && r.status === "RELEASED" ? `, released by ${batch.releasedBy}` : ""}</div><div className="text-sm muted" style={{ color: "var(--ink-2)" }}>“{d.rationale}”</div></div></div>
          {proposal && <div className="">Proposed rule from this decision: <Link href="/rules" className="underline">{proposal.status === "ACTIVE" ? "active" : proposal.status.toLowerCase()} → review on Rules</Link>{proposal.replayImpact && <> · would have changed <b>{proposal.replayImpact.wouldChange}</b> past decision{proposal.replayImpact.wouldChange === 1 ? "" : "s"}</>}</div>}
        </section>
      )}
    </div>
  );
}

function ExtractedView({ ext }: { ext: Extracted }) {
  const rows: [string, Field<unknown> | undefined, (v: unknown) => string][] = [
    [FIELD_LABEL.vendorName, ext.vendorName, String],
    [FIELD_LABEL.amountCents, ext.amountCents, (v) => money(v as number)],
    [FIELD_LABEL.date, ext.date, String],
    [FIELD_LABEL.clientNameOnDoc, ext.clientNameOnDoc, String],
  ];
  return (
    <div className="grid gap-1.5">
      {rows.filter(([, f]) => f).map(([label, f, fmt]) => (
        <div key={label} className={`field grid gap-0.5 ${f!.confidence < 0.8 ? "field-low" : ""}`} title={`${Math.round(f!.confidence * 100)}% confidence`}>
          <div className="flex justify-between text-[11px]"><span className="muted">{label}</span><span style={{ color: f!.confidence < 0.8 ? "var(--flag)" : "var(--ink-3)" }}>{confidenceWord(f!.confidence).word}</span></div>
          <div className="font-medium text-[15px]">{fmt(f!.value)}</div>
          {f!.evidence && <div className="mono text-[11px]" style={{ color: "var(--ink-3)" }}>“{f!.evidence}”</div>}
        </div>
      ))}
      {ext.lineItems && (
        <div className={`field ${ext.lineItems.confidence < 0.8 ? "field-low" : ""}`}>
          <div className="flex justify-between text-[11px]" title={`${Math.round(ext.lineItems.confidence * 100)}% confidence`}><span className="muted">{FIELD_LABEL.lineItems}</span><span style={{ color: ext.lineItems.confidence < 0.8 ? "var(--flag)" : "var(--ink-3)" }}>{confidenceWord(ext.lineItems.confidence).word}</span></div>
          {ext.lineItems.value.map((l, i) => (
            <div key={i} className="flex justify-between text-sm"><span>{l.label} {l.flag && l.flag !== "other" && <span className={`chip ${l.flag === "late_fee" || l.flag === "reconnection_penalty" || l.flag === "device_purchase" || l.flag === "gift_card" ? "chip-hard" : "chip-grey"}`} style={{ fontSize: ".6rem" }}>{l.flag.replace(/_/g, " ")}</span>}</span><span className="mono">{money(l.cents)}</span></div>
          ))}
        </div>
      )}
      {ext.notes && <div className="text-sm muted" style={{ color: "var(--ink-2)" }}>{ext.notes}</div>}
    </div>
  );
}
