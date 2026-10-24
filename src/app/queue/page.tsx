import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { TriggerChip } from "@/components/TriggerChip";
import { Money } from "@/components/Money";
import { processAllAction } from "@/app/actions";

export default async function QueuePage() {
  const pending = db.select({ r: schema.requests, d: schema.decisions, c: schema.clients })
    .from(schema.requests)
    .leftJoin(schema.decisions, eq(schema.decisions.requestId, schema.requests.id))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.requests.clientId))
    .where(inArray(schema.requests.status, ["ESCALATED"]))
    .orderBy(desc(schema.requests.requestedAt)).all();
  const all = db.select({ status: schema.requests.status }).from(schema.requests).all();
  const n = (s: string) => all.filter((x) => x.status === s).length;
  const paid = n("DISBURSED") + n("APPROVED");
  const recent = db.select({ r: schema.requests, d: schema.decisions })
    .from(schema.requests).innerJoin(schema.decisions, eq(schema.decisions.requestId, schema.requests.id))
    .where(inArray(schema.requests.status, ["DISBURSED", "APPROVED", "DENIED"]))
    .orderBy(desc(schema.decisions.decidedAt)).limit(8).all();

  return (
    <div className="grid gap-8">
      <section className="grid md:grid-cols-[1fr_auto] gap-6 items-end">
        <div>
          <div className="kicker mb-2">Client assistance · this week</div>
          <h1 className="display" style={{ fontSize: 72 }}>
            {pending.length} waiting<br /><span style={{ color: "var(--yellow-ink)" }}>for a seal.</span>
          </h1>
        </div>
        <div className="grid grid-cols-3 gap-3 md:min-w-[420px]">
          <Stat n={paid} label="paid, no human touch" />
          <Stat n={pending.length} label="asked a person" accent />
          <Stat n={n("DENIED")} label="denied, by people" />
        </div>
      </section>

      {n("NEW") > 0 && (
        <form action={processAllAction} className="slab p-6 flex flex-wrap items-center gap-5">
          <div className="display text-3xl" style={{ color: "var(--yellow)" }}>{n("NEW")} new requests</div>
          <div className="serif" style={{ color: "var(--clay)" }}>Read, check, pay within limits, or ask.</div>
          <button className="btn btn-yellow ml-auto">Run the agent</button>
        </form>
      )}

      <section className="grid gap-3">
        {pending.length === 0 && <div className="card p-10 text-center serif italic" style={{ color: "var(--ink2)" }}>Nothing waiting. {n("NEW") > 0 ? "Run the agent." : "Create a request to see the agent work."}</div>}
        {pending.map(({ r, d, c }) => {
          const hard = d?.triggers.some((t) => t.code === "DUP-HIT" || t.code === "POL-HARD" || t.code === "VENDOR-FLAG");
          return (
            <Link key={r.id} href={`/requests/${r.id}`} className="card p-5 grid md:grid-cols-[180px_1fr_auto] gap-5 items-center hover:shadow-md transition-shadow" style={{ boxShadow: hard ? "inset 6px 0 0 var(--black)" : "inset 6px 0 0 var(--yellow)" }}>
              <div>
                <div className="num text-4xl"><Money cents={r.requestedCents} /></div>
                <div className="kicker mt-1">{r.category}</div>
              </div>
              <div className="grid gap-2">
                <div className="serif text-lg">to <b>{r.vendorNameRaw}</b> for {c.displayName} <span style={{ color: "var(--ink2)" }}>· {r.requestedAt}</span></div>
                <div className="flex flex-wrap gap-1.5">{d?.triggers.map((t, i) => <TriggerChip key={i} t={t} />)}</div>
                {d?.caseSummary && <div className="serif italic text-sm" style={{ color: "var(--ink2)" }}>{d.caseSummary}</div>}
              </div>
              <div className="mono text-xs" style={{ color: "var(--clay)" }}>{r.id}</div>
            </Link>
          );
        })}
      </section>

      {recent.length > 0 && (
        <section>
          <div className="kicker mb-3">Recently sealed</div>
          <div className="card p-2">
            <table className="ui">
              <thead><tr><th>Request</th><th>Category</th><th>Amount</th><th>Outcome</th><th>By</th><th>Allocation</th><th>When</th></tr></thead>
              <tbody>
                {recent.map(({ r, d }) => (
                  <tr key={r.id}>
                    <td><Link className="mono underline underline-offset-4" href={`/requests/${r.id}`}>{r.id}</Link></td>
                    <td>{r.category}</td><td><Money cents={r.requestedCents} /></td>
                    <td><span className={`chip ${d.outcome === "DENIED" ? "chip-hard" : "chip-ok"}`}>{d.outcome}</span></td>
                    <td>{d.decidedBy === "HUMAN" ? <span style={{ color: "var(--seal)" }}>● human</span> : <span style={{ color: "var(--ink2)" }}>○ system</span>}</td>
                    <td className="mono text-xs">{d.allocation.map((a) => `${a.grantId} $${(a.cents / 100).toFixed(0)}`).join(" + ")}</td>
                    <td className="text-xs" style={{ color: "var(--ink2)" }}>{d.decidedAt.slice(11, 19)}</td>
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

function Stat({ n, label, accent = false }: { n: number; label: string; accent?: boolean }) {
  return (
    <div className="card p-4" style={accent ? { background: "var(--yellow)" } : undefined}>
      <div className="num text-5xl">{n}</div>
      <div className="kicker mt-1" style={{ color: accent ? "var(--black)" : undefined }}>{label}</div>
    </div>
  );
}
