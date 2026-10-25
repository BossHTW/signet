import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { Money } from "@/components/Money";
import { TriggerChip } from "@/components/TriggerChip";
import { NessieInspect } from "@/components/NessieInspect";
import { certifyBatchAction, releaseBatchAction } from "@/app/actions";
import { currentHuman } from "@/lib/role";
import { DUAL_CONTROL_CENTS, ROLES } from "@/db/types";

type PaymentTxn = { grantId?: string; cents?: number; txnId: string; accountId?: string; raw?: unknown };
type PaymentPayload = { txns?: PaymentTxn[]; source?: string; batchId?: string };

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentHuman();
  const b = db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.id, id)).get();
  if (!b) notFound();
  const rows = b.itemIds.length ? db.select({ r: schema.requests, d: schema.decisions, c: schema.clients }).from(schema.requests)
    .innerJoin(schema.decisions, eq(schema.decisions.requestId, schema.requests.id))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.requests.clientId))
    .where(inArray(schema.requests.id, b.itemIds)).all() : [];
  const sampled = new Set(b.sampleIds); const attested = new Set(b.attestedIds);
  const left = b.sampleIds.filter((x) => !attested.has(x)).length;
  const canCertify = b.status === "OPEN" && left === 0 && me.role === "supervisor";
  const canRelease = b.status === "CERTIFIED" && me.role === "finance" && b.certifiedBy !== me.id;
  const payments = b.status === "RELEASED"
    ? db.select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "PAYMENT_SENT")).all()
      .filter((e) => (e.payload as PaymentPayload).batchId === b.id)
    : [];
  const payByRequest = new Map(payments.map((e) => [e.requestId, e.payload as PaymentPayload]));
  const firstTxn = payments.flatMap((e) => (e.payload as PaymentPayload).txns ?? [])[0];
  const paySource = (payments[0]?.payload as PaymentPayload | undefined)?.source;

  return (
    <div className="grid gap-6">
      <div className="flex items-start gap-6 flex-wrap">
        <div className="grid gap-2">
          <div className="kicker"><Link href="/batches" className="underline underline-offset-4">Release</Link> &nbsp;/&nbsp; <span className="mono normal-case tracking-normal">{b.id}</span></div>
          <h1 className="display-std text-[28px]">{b.itemIds.length} payments · <Money cents={b.totalCents} /></h1>
          <div className="muted">Opened by {b.openedBy} · {b.openedAt.slice(0, 16).replace("T", " ")}{b.certifiedBy && <> · certified by <b>{b.certifiedBy}</b></>}{b.releasedBy && <> · released by <b>{b.releasedBy}</b></>}</div>
        </div>
        <div className="ml-auto grid gap-2 text-right">
          <span className={`chip ${b.status === "RELEASED" ? "chip-ok" : b.status === "CERTIFIED" ? "chip-hard" : "chip-flag"}`}>{b.status === "RELEASED" ? "Released" : b.status === "CERTIFIED" ? "Certified" : "Open"}</span>
          <div className="kicker">sample {b.sampleIds.length - left}/{b.sampleIds.length} read</div>
        </div>
      </div>

      {/* The act of certification / release */}
      <section className="slab p-7 grid md:grid-cols-[1fr_auto] gap-5 items-center">
        {b.status === "OPEN" && (
          <>
            <div>
              <div className="display-std text-xl">{left === 0 ? "Sample read. Certify the batch." : `Open ${left} more sampled item${left === 1 ? "" : "s"}.`}</div>
              <div className="mt-1" style={{ color: "var(--ink-3)" }}>Sampled rows are marked. Open each, read the document and the checks, and attest at the bottom of the page. Items at or above ${DUAL_CONTROL_CENTS / 100} are always in the sample. Certifying signs: “the items in this batch are proper for payment under the funding rules shown.”</div>
            </div>
            <form action={certifyBatchAction}><input type="hidden" name="batchId" value={b.id} />
              <button className="btn btn-primary btn-lg" disabled={!canCertify} title={me.role !== "supervisor" ? `Only the ${ROLES.supervisor.title} certifies` : left ? "read the sample first" : ""}>Certify {b.itemIds.length} payments</button></form>
          </>
        )}
        {b.status === "CERTIFIED" && (
          <>
            <div>
              <div className="display-std text-xl">Certified by {b.certifiedBy}. Release the money.</div>
              <div className="mt-1" style={{ color: "var(--ink-3)" }}>A different person must release. {me.role === "finance" ? "You are the Finance Director: releasing sends each payment through the bank adapter and seals the record." : `Switch to ${ROLES.finance.id} in the header.`}</div>
            </div>
            <form action={releaseBatchAction}><input type="hidden" name="batchId" value={b.id} />
              <button className="btn btn-seal btn-lg" disabled={!canRelease}>Release <Money cents={b.totalCents} /></button></form>
          </>
        )}
        {b.status === "RELEASED" && (
          <div>
            <div className="display-std text-xl">Released {b.releasedAt?.slice(0, 16).replace("T", " ")}.</div>
            <div className="mt-1" style={{ color: "var(--ink-3)" }}>Certified by {b.certifiedBy}, released by {b.releasedBy}. Every payment carries both names in the audit log.</div>
            {firstTxn?.accountId && <div className="mt-2 text-sm">Operating account <span className="mono">{firstTxn.accountId}</span> · {paySource}</div>}
          </div>
        )}
      </section>

      <div className="card p-2">
        <table className="ui">
          <thead><tr><th></th><th>Request</th><th>Category</th><th>Amount</th><th>To</th><th>For</th><th>Checks</th><th>Verified by</th>{b.status === "RELEASED" && <th>Nessie</th>}<th></th></tr></thead>
          <tbody>
            {rows.sort((a, b2) => Number(sampled.has(b2.r.id)) - Number(sampled.has(a.r.id)) || b2.r.requestedCents - a.r.requestedCents).map(({ r, d, c }) => {
              const isS = sampled.has(r.id); const isA = attested.has(r.id);
              const pay = payByRequest.get(r.id);
              const txn = pay?.txns?.[0];
              return (
                <tr key={r.id} className={isS && !isA ? "spine" : undefined} style={isS && !isA ? { ["--spine" as string]: "var(--ink)", background: "var(--paper)" } : isA ? { background: "var(--paper)" } : undefined}>
                  <td>{isS ? <span className={`chip ${isA ? "chip-verify" : "chip-flag"}`}>{isA ? "Read" : r.requestedCents >= DUAL_CONTROL_CENTS ? "Dual control" : "Sampled"}</span> : null}</td>
                  <td><Link className="mono underline underline-offset-4" href={`/requests/${r.id}?batch=${b.id}`}>{r.id}</Link></td>
                  <td>{r.category}</td><td className="tabular"><Money cents={r.requestedCents} /></td>
                  <td>{r.vendorNameRaw}</td><td>{c.displayName}</td>
                  <td><div className="flex flex-wrap gap-1">{d.triggers.length ? d.triggers.map((t, i) => <TriggerChip key={i} t={t} />) : <span className="chip chip-verify">Clear</span>}</div></td>
                  <td className="text-[13px]">{d.decidedBy === "HUMAN" ? d.humanId : <span className="muted">System</span>}</td>
                  {b.status === "RELEASED" && (
                    <td className="text-[12px]">
                      {txn ? <div className="grid gap-1"><span className="mono">{txn.txnId}</span>{txn.accountId && <span className="mono faint">{txn.accountId}</span>}<NessieInspect raw={txn.raw} /></div> : <span className="faint">—</span>}
                    </td>
                  )}
                  <td>{isS && !isA && b.status === "OPEN" && <Link href={`/requests/${r.id}?batch=${b.id}`} className="btn">Open and read</Link>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
