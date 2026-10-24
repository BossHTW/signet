import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { activateRuleAction, rejectRuleAction } from "@/app/actions";

export default function RulesPage() {
  const proposals = db.select().from(schema.ruleProposals).orderBy(desc(schema.ruleProposals.createdAt)).all();
  const srcReq = (decisionId: string) => db.select({ requestId: schema.decisions.requestId }).from(schema.decisions).where(eq(schema.decisions.id, decisionId)).get()?.requestId;
  const proposed = proposals.filter((p) => p.status === "PROPOSED");
  const active = proposals.filter((p) => p.status === "ACTIVE");
  const rejected = proposals.filter((p) => p.status === "REJECTED");

  return (
    <div className="grid gap-6">
      <div>
        <div className="kicker mb-2">Learning loop</div>
        <h1 className="display" style={{ fontSize: 64 }}>Rules the agent<br /><span style={{ color: "var(--yellow-ink)" }}>learned from you.</span></h1>
        <p className="serif text-lg mt-3 max-w-3xl" style={{ color: "var(--ink2)" }}>Every human decision proposes a rule from your rationale. It is replayed against history before you activate it. The agent never activates a rule.</p>
      </div>

      <section className="grid gap-3">
        <div className="kicker">Proposed ({proposed.length})</div>
        {proposed.length === 0 && <div className="card p-8 serif italic" style={{ color: "var(--ink2)" }}>No proposals yet. Decide something in the queue.</div>}
        {proposed.map((p) => (
          <form key={p.id} action={activateRuleAction} className="card p-6 grid md:grid-cols-[1fr_320px] gap-6" style={{ boxShadow: "inset 6px 0 0 var(--yellow)" }}>
            <input type="hidden" name="proposalId" value={p.id} />
            <div className="grid gap-2">
              <div className="flex items-center gap-2"><span className={`chip ${p.action === "escalate" ? "chip-hard" : p.action === "allow_within_limit" ? "chip-ok" : "chip-flag"}`}>{p.action}</span><span className="text-xs" style={{ color: "var(--ink2)" }}>from <Link className="underline mono" href={`/requests/${srcReq(p.sourceDecisionId)}`}>{srcReq(p.sourceDecisionId)}</Link> · {p.createdAt.slice(0, 16).replace("T", " ")}</span></div>
              <div className="serif text-lg">“{p.rationale}”</div>
              <label>Rule (editable JSON predicate)</label>
              <textarea name="predicate" rows={5} className="mono text-xs" defaultValue={JSON.stringify(p.predicate, null, 2)} />
            </div>
            <div className="grid gap-2 content-start">
              <div className="slab p-4">
                <div className="kicker" style={{ color: "var(--clay)" }}>Replay against history</div>
                <div className="num text-6xl" style={{ color: "var(--yellow)" }}>{p.replayImpact?.wouldChange ?? 0}</div><div className="serif" style={{ color: "var(--concrete)" }}>decision{p.replayImpact?.wouldChange === 1 ? "" : "s"} would change</div>
                <div className="text-xs" style={{ color: "var(--clay)" }}>{p.replayImpact?.matched ?? 0} past requests match this rule</div>
                {p.replayImpact?.ids.length ? <div className="mono text-[11px] mt-1">{p.replayImpact.ids.slice(0, 6).join(", ")}</div> : null}
              </div>
              <button className="btn btn-seal">Activate rule &amp; seal</button>
              <button formAction={rejectRuleAction} className="btn">Reject</button>
            </div>
          </form>
        ))}
      </section>

      <section className="grid gap-2">
        <div className="kicker">Active ({active.length})</div>
        {active.map((p) => (
          <div key={p.id} className="card p-4 grid md:grid-cols-[140px_1fr_200px] gap-4 items-center">
            <span className={`chip ${p.action === "escalate" ? "chip-hard" : p.action === "allow_within_limit" ? "chip-ok" : "chip-flag"}`}>{p.action}</span>
            <div><div className="serif">“{p.rationale}”</div><pre className="mono text-[11px] mt-1" style={{ color: "var(--ink2)" }}>{JSON.stringify(p.predicate)}</pre></div>
            <div className="text-xs" style={{ color: "var(--ink2)" }}>activated by {p.activatedBy}<br />{p.activatedAt?.slice(0, 16).replace("T", " ")} · changed {p.replayImpact?.wouldChange ?? 0}</div>
          </div>
        ))}
        {active.length === 0 && <div className="text-sm" style={{ color: "var(--ink2)" }}>None active yet.</div>}
      </section>

      {rejected.length > 0 && <section className="text-xs" style={{ color: "var(--ink2)" }}>{rejected.length} rejected proposal{rejected.length === 1 ? "" : "s"} kept in the audit log.</section>}
    </div>
  );
}
