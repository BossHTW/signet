import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { TriggerChip } from "@/components/TriggerChip";
import { Money } from "@/components/Money";
import { processAllAction, openBatchAction } from "@/app/actions";
import { openBatchPreview } from "@/lib/pipeline";
import { currentRole } from "@/lib/role";
import { DUAL_CONTROL_CENTS, SAMPLE_MIN, SAMPLE_RATE } from "@/db/types";

export default async function QueuePage() {
  const role = await currentRole();
  const pending = db.select({ r: schema.requests, d: schema.decisions, c: schema.clients })
    .from(schema.requests)
    .leftJoin(schema.decisions, eq(schema.decisions.requestId, schema.requests.id))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.requests.clientId))
    .where(inArray(schema.requests.status, ["ESCALATED"]))
    .orderBy(desc(schema.requests.requestedAt)).all();
  const all = db.select({ status: schema.requests.status }).from(schema.requests).all();
  const n = (s: string) => all.filter((x) => x.status === s).length;
  const ready = openBatchPreview();
  const recent = db.select({ r: schema.requests, d: schema.decisions })
    .from(schema.requests).innerJoin(schema.decisions, eq(schema.decisions.requestId, schema.requests.id))
    .where(inArray(schema.requests.status, ["RELEASED", "APPROVED", "DENIED"]))
    .orderBy(desc(schema.decisions.decidedAt)).limit(8).all();
  const certifiedWaiting = db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.status, "CERTIFIED")).all();

  return (
    <div className="grid gap-8">
      <section className="grid md:grid-cols-[1fr_auto] gap-6 items-end">
        <div>
          <div className="kicker mb-2">Client assistance · this week</div>
          <h1 className="display-std text-[28px]">
            {pending.length} need<br /><span style={{ color: "var(--ink)" }}>a person&rsquo;s eyes.</span>
          </h1>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 md:min-w-[420px]">
          <Stat n={ready.count} label="verified · ready to certify" />
          <Stat n={pending.length} label="opened one by one" />
          <Stat n={n("RELEASED")} label="paid · two humans each" />
        </div>
      </section>

      {n("NEW") > 0 && (
        <form action={processAllAction} className="slab p-6 flex flex-wrap items-center gap-5">
          <div className="display-std text-xl">{n("NEW")} new requests</div>
          <div className="" style={{ color: "var(--ink-3)" }}>Read, check, sort. The agent never pays.</div>
          <button className="btn btn-primary btn-lg ml-auto">Run the agent</button>
        </form>
      )}

      {ready.count > 0 && (
        <section className="card p-6 grid md:grid-cols-[1fr_auto] gap-5 items-center spine" style={{ ["--spine" as string]: "var(--ink)" }}>
          <div className="grid gap-1">
            <div className="display-std text-2xl">{ready.count} verified items · <Money cents={ready.totalCents} /> · ready for a release batch</div>
            <div className="" style={{ color: "var(--ink-2)" }}>
              Every check clear, within the batch limit, one grant. The Program Supervisor opens a batch, reads a random sample
              ({SAMPLE_MIN} or {Math.round(SAMPLE_RATE * 100)}%, plus all {ready.dualControl} item{ready.dualControl === 1 ? "" : "s"} at or above ${DUAL_CONTROL_CENTS / 100}), certifies; the Finance Director releases. Nothing is paid before that.
            </div>
          </div>
          {role === "supervisor"
            ? <form action={openBatchAction}><button className="btn btn-primary">Open release batch</button></form>
            : <div className="text-sm muted" style={{ color: "var(--ink-3)" }}>Switch to program.supervisor to open a batch.</div>}
        </section>
      )}
      {certifiedWaiting.length > 0 && (
        <Link href={`/batches/${certifiedWaiting[0].id}`} className="card p-5 flex items-center gap-4 spine" style={{ ["--spine" as string]: "var(--seal)" }}>
          <span className="chip chip-hard">Certified</span>
          <span className="">Batch {certifiedWaiting[0].id} · {certifiedWaiting[0].itemIds.length} items · <Money cents={certifiedWaiting[0].totalCents} /> waits for the Finance Director to release.</span>
        </Link>
      )}

      <section className="grid gap-3">
        <div className="kicker">Escalations · each opened by a person</div>
        {pending.length === 0 && <div className="card p-8 text-center muted">Nothing waiting. {n("NEW") > 0 ? "Run the agent." : "Create a request to see the agent work."}</div>}
        {pending.map(({ r, d, c }) => (
            <Link key={r.id} href={`/requests/${r.id}`} className="card p-4 grid md:grid-cols-[160px_1fr_auto] gap-4 items-center">
              <div>
                <div className="num text-[32px]"><Money cents={r.requestedCents} /></div>
                <div className="kicker mt-1">{r.category}</div>
              </div>
              <div className="grid gap-2 min-w-0">
                <div>to <b>{r.vendorNameRaw}</b> for {c.displayName} <span className="muted">· {r.requestedAt}</span></div>
                <div className="flex flex-wrap gap-1.5">{d?.triggers.map((t, i) => <TriggerChip key={i} t={t} />)}</div>
                {d?.caseSummary && <div className="text-[14px] muted">{d.caseSummary}</div>}
              </div>
              <div className="mono text-[12px] faint">{r.id}</div>
            </Link>
        ))}
      </section>

      {recent.length > 0 && (
        <section>
          <div className="kicker mb-3">Recently sealed by people</div>
          <div className="card p-2">
            <table className="ui">
              <thead><tr><th>Request</th><th>Category</th><th>Amount</th><th>Outcome</th><th>By</th><th>Allocation</th><th>When</th></tr></thead>
              <tbody>
                {recent.map(({ r, d }) => (
                  <tr key={r.id}>
                    <td><Link className="mono underline underline-offset-4" href={`/requests/${r.id}`}>{r.id}</Link></td>
                    <td>{r.category}</td><td><Money cents={r.requestedCents} /></td>
                    <td><span className={`chip ${d.outcome === "DENIED" ? "chip-hard" : r.status === "RELEASED" ? "chip-ok" : "chip-verify"}`}>{r.status === "RELEASED" ? "Paid" : d.outcome === "DENIED" ? "Denied" : "Certified"}</span></td>
                    <td>{d.humanId}</td>
                    <td className="mono text-xs">{d.allocation.map((a) => `${a.grantId} $${(a.cents / 100).toFixed(0)}`).join(" + ")}</td>
                    <td className="text-xs" style={{ color: "var(--ink-2)" }}>{d.decidedAt.slice(11, 19)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="card p-4">
      <div className="num text-[32px]">{n}</div>
      <div className="kicker mt-1">{label}</div>
    </div>
  );
}
