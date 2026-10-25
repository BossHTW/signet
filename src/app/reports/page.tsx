import { db, schema } from "@/db/client";
import { money } from "@/components/Money";
import { regenerateReportsAction } from "@/app/actions";

export default function ReportsPage() {
  const reps = db.select().from(schema.complianceReports).all();
  const grants = Object.fromEntries(db.select().from(schema.grantStreams).all().map((g) => [g.id, g]));
  return (
    <div className="grid gap-4">
      <div className="flex items-end gap-4">
        <div><div className="kicker mb-2">For the funders</div><h1 className="display-std text-[28px]">Compliance<br /><span style={{ color: "var(--ink)" }}>reports.</span></h1><p className="muted mt-3 max-w-3xl" style={{ color: "var(--ink-2)" }}>What each funder receives on the first of the month: every dollar, which request, who sealed it, and the hash to verify it. Generated, not assembled.</p></div>
        <div className="ml-auto flex gap-2"><form action={regenerateReportsAction}><button className="btn">Regenerate</button></form><a className="btn" href="/api/reports.csv">Export CSV</a></div>
      </div>
      {reps.length === 0 && <div className="card p-6 text-sm" style={{ color: "var(--ink-2)" }}>No reports yet. Run the agent, then regenerate.</div>}
      <div className="grid md:grid-cols-2 gap-4">
        {reps.map((r) => {
          const g = grants[r.grantId];
          return (
            <section key={r.id} className="card p-5 grid gap-3">
              <div className="flex items-baseline gap-3"><div className="display-std text-xl">{r.grantId}</div><span className="" style={{ color: "var(--ink-2)" }}>{g?.name}</span></div>
              <div className="text-xs" style={{ color: "var(--ink-2)" }}>{g?.funder} · {r.periodStart} → {r.periodEnd} · allowed: {g?.allowedCategories.join(", ")} · prohibits: {g?.prohibitedItems.join(", ") || "—"}</div>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-3 rounded-xl" style={{ background: "var(--paper)" }}><div className="num text-2xl">{money(r.totals.cents)}</div><div className="text-[11px]" style={{ color: "var(--ink-2)" }}>disbursed</div></div>
                <div className="p-3 rounded-xl" style={{ background: "var(--paper)" }}><div className="num text-2xl">{r.totals.count}</div><div className="text-[11px]" style={{ color: "var(--ink-2)" }}>requests</div></div>
                <div className="p-3 rounded-xl" style={{ background: "var(--paper)" }}><div className="num text-2xl">{r.totals.escalated}</div><div className="text-[11px]" style={{ color: "var(--ink-2)" }}>pending human</div></div>
                <div className="p-3 rounded-xl" style={{ background: "var(--paper)" }}><div className="num text-2xl">{r.totals.denied}</div><div className="text-[11px]" style={{ color: "var(--ink-2)" }}>denied</div></div>
              </div>
              <div className="text-xs" style={{ color: "var(--ink-2)" }}>Remaining in grant: {g ? money(g.totalCents - g.spentCents) : "—"} of {g ? money(g.totalCents) : "—"}</div>
              {r.rows.length > 0 && (
                <table className="ui"><thead><tr><th>Request</th><th>Cat.</th><th>Amount</th><th>Seal</th><th>Hash</th></tr></thead>
                  <tbody>{r.rows.slice(0, 8).map((x) => <tr key={x.requestId}><td className="mono text-xs">{x.requestId}</td><td>{x.category}</td><td className="tabular">{money(x.cents)}</td><td>{x.decidedBy === "HUMAN" ? x.outcome : <span className="muted">{x.outcome}</span>}</td><td className="mono text-[11px] faint">{x.sealHash}</td></tr>)}</tbody></table>
              )}
              {r.rows.length > 8 && <div className="text-xs" style={{ color: "var(--ink-2)" }}>+{r.rows.length - 8} more in the CSV</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
