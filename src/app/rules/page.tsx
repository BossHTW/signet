import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ROLES } from "@/db/types";
import { activateRuleAction, rejectRuleAction, reprocessManyAction, retireRuleAction } from "@/app/actions";
import { WAIVE_COPY } from "@/lib/engine/rules";

function RuleChip({ action }: { action: string }) {
  if (action === "allow_within_limit") return <span className="chip chip-ok">Allow within limit</span>;
  return <span className={`chip ${action === "escalate" ? "chip-hard" : "chip-flag"}`}>{action}</span>;
}
function WaiveNote({ action }: { action: string }) {
  if (action !== "allow_within_limit") return null;
  return <p className="text-xs" style={{ color: "var(--ink-2)" }}>Can waive: {WAIVE_COPY.can}. Never: {WAIVE_COPY.never}.</p>;
}

function personName(humanId: string | null | undefined) {
  const role = Object.values(ROLES).find((r) => r.id === humanId);
  return role ? role.title.replace(/ \(.*\)/, "") : humanId || "a person";
}

export default function RulesPage() {
  const proposals = db.select().from(schema.ruleProposals).orderBy(desc(schema.ruleProposals.createdAt)).all();
  const src = (decisionId: string) => db.select({ requestId: schema.decisions.requestId, humanId: schema.decisions.humanId }).from(schema.decisions).where(eq(schema.decisions.id, decisionId)).get();
  const proposed = proposals.filter((p) => p.status === "PROPOSED");
  const active = proposals.filter((p) => p.status === "ACTIVE");
  const retired = proposals.filter((p) => p.status === "RETIRED");
  const rejected = proposals.filter((p) => p.status === "REJECTED");
  const retireEvents = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "RULE_RETIRED")).all();
  const proposedEvents = db.select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "RULE_PROPOSED")).all();
  const retiredBy = (proposalId: string) => {
    const ev = retireEvents.find((e) => (e.payload as { proposalId?: string }).proposalId === proposalId);
    const payload = (ev?.payload ?? {}) as { reason?: string; retiredAt?: string };
    return { actor: ev?.actor?.replace(/^human:/, "") ?? null, reason: payload.reason ?? null, at: payload.retiredAt ?? null };
  };
  const draftOf = (proposalId: string, decisionId: string) => {
    const ev = proposedEvents.find((e) => (e.payload as { proposalId?: string }).proposalId === proposalId);
    const payload = (ev?.payload ?? {}) as { draftedBy?: string; title?: string };
    const draftedBy = payload.draftedBy ?? "template";
    const who = personName(src(decisionId)?.humanId);
    return { title: payload.title ?? null, line: draftedBy.startsWith("claude:") ? `Drafted by Claude from ${who}'s reason · limits enforced by code` : "Drafted from template" };
  };

  return (
    <div className="grid gap-6">
      <div>
        <div className="kicker mb-2">Learning loop</div>
        <h1 className="display-std text-[28px]">Rules the agent<br /><span style={{ color: "var(--ink)" }}>learned from you.</span></h1>
        <p className="muted mt-3 max-w-3xl" style={{ color: "var(--ink-2)" }}>Every human decision proposes a rule from your rationale. It is replayed against history before anyone activates it. A rule is a control change, so it takes a second person: the Program Supervisor&rsquo;s rationale proposes, the Finance Director activates. The agent never activates a rule.</p>
      </div>

      <section className="grid gap-3">
        <div className="kicker">Proposed ({proposed.length})</div>
        {proposed.length === 0 && <div className="card p-8 muted">No proposals yet. Decide something in the queue.</div>}
        {proposed.map((p) => (
          <form key={p.id} action={activateRuleAction} className="card p-6 grid md:grid-cols-[1fr_320px] gap-6 spine" style={{ ["--spine" as string]: "var(--ink)" }}>
            <input type="hidden" name="proposalId" value={p.id} />
            <div className="grid gap-2">
              <div className="flex items-center gap-2"><RuleChip action={p.action} /><span className="text-xs" style={{ color: "var(--ink-2)" }}>from <Link className="underline mono" href={`/requests/${src(p.sourceDecisionId)?.requestId}`}>{src(p.sourceDecisionId)?.requestId}</Link> · {p.createdAt.slice(0, 16).replace("T", " ")}</span></div>
              {draftOf(p.id, p.sourceDecisionId).title && <div className="font-medium">{draftOf(p.id, p.sourceDecisionId).title}</div>}
              <div className="text-xs" style={{ color: "var(--ink-3)" }}>{draftOf(p.id, p.sourceDecisionId).line}</div>
              <div className="muted">“{p.rationale}”</div>
              <WaiveNote action={p.action} />
              <label>Rule (editable JSON predicate)</label>
              <textarea name="predicate" rows={5} className="mono text-xs" defaultValue={JSON.stringify(p.predicate, null, 2)} />
            </div>
            <div className="grid gap-2 content-start">
              <div className="card p-4">
                <div className="kicker">Replay against history</div>
                <div className="num text-[48px] mt-2">{p.replayImpact?.wouldChange ?? 0}</div>
                <div className="muted">decision{p.replayImpact?.wouldChange === 1 ? "" : "s"} would change</div>
                <div className="text-[12px] muted mt-1">{p.replayImpact?.matched ?? 0} past requests match this rule</div>
                {p.replayImpact?.ids.length ? <div className="mono text-[11px] faint mt-1">{p.replayImpact.ids.slice(0, 6).join(", ")}</div> : null}
              </div>
              <button className="btn btn-seal btn-lg">Activate rule &amp; seal</button>
              <button formAction={rejectRuleAction} className="btn">Reject</button>
            </div>
          </form>
        ))}
      </section>

      <section className="grid gap-2">
        <div className="kicker">Active ({active.length})</div>
        {active.length > 0 && <p className="text-sm max-w-3xl" style={{ color: "var(--ink-2)" }}>Retiring a rule is itself a control change — it needs a reason, a second person (Finance), and is logged. A released payment, by contrast, can only be reversed by a new compensating entry, never by editing the record.</p>}
        {active.map((p) => (
          <div key={p.id} className="card p-4 grid gap-4">
            <div className="grid md:grid-cols-[140px_1fr_200px] gap-4 items-start">
              <RuleChip action={p.action} />
              <div>
                {draftOf(p.id, p.sourceDecisionId).title && <div className="font-medium">{draftOf(p.id, p.sourceDecisionId).title}</div>}
                <div className="text-xs mt-1" style={{ color: "var(--ink-3)" }}>{draftOf(p.id, p.sourceDecisionId).line}</div>
                <div className="mt-1">“{p.rationale}”</div>
                <WaiveNote action={p.action} />
                <pre className="mono text-[11px] mt-1" style={{ color: "var(--ink-2)" }}>{JSON.stringify(p.predicate)}</pre>
              </div>
              <div className="text-xs grid gap-2" style={{ color: "var(--ink-2)" }}>
                activated by {p.activatedBy}<br />{p.activatedAt?.slice(0, 16).replace("T", " ")} · changed {p.replayImpact?.wouldChange ?? 0}
                {(p.replayImpact?.wouldChange ?? 0) > 0 ? (
                  <form action={reprocessManyAction.bind(null, p.replayImpact?.ids ?? [])}>
                    <button className="btn">Reprocess {p.replayImpact?.wouldChange} affected request{p.replayImpact?.wouldChange === 1 ? "" : "s"}</button>
                  </form>
                ) : null}
              </div>
            </div>
            <form action={retireRuleAction} className="grid gap-2 md:grid-cols-[1fr_auto] items-end">
              <input type="hidden" name="proposalId" value={p.id} />
              <div>
                <label htmlFor={`retire-${p.id}`}>Reason</label>
                <input id={`retire-${p.id}`} name="reason" required placeholder="Why this rule should stop applying" />
              </div>
              <button className="btn btn-seal">Retire rule</button>
            </form>
          </div>
        ))}
        {active.length === 0 && <div className="text-sm" style={{ color: "var(--ink-2)" }}>None active yet.</div>}
      </section>

      {retired.length > 0 && (
        <section className="grid gap-2">
          <div className="kicker">Retired ({retired.length})</div>
          {retired.map((p) => {
            const who = retiredBy(p.id);
            return (
              <div key={p.id} className="card p-4 grid gap-2" style={{ color: "var(--ink-3)" }}>
                <div className="flex items-center gap-2">
                  <span className="line-through font-medium">Retired</span>
                  <RuleChip action={p.action} />
                </div>
                <div className="line-through">“{p.rationale}”</div>
                <div className="text-xs">{draftOf(p.id, p.sourceDecisionId).line}</div>
                <WaiveNote action={p.action} />
                <div className="text-xs">{who.actor ? <>{who.actor}{who.reason ? ` · ${who.reason}` : ""}{who.at ? ` · ${who.at.slice(0, 16).replace("T", " ")}` : ""}</> : "No retire event on the audit log."}</div>
                {p.replayImpact?.ids?.length ? (
                  <form action={reprocessManyAction.bind(null, p.replayImpact.ids)}>
                    <button className="btn">Reprocess {p.replayImpact.ids.length} previously-affected request{p.replayImpact.ids.length === 1 ? "" : "s"}</button>
                  </form>
                ) : null}
              </div>
            );
          })}
        </section>
      )}

      {rejected.length > 0 && <section className="text-xs" style={{ color: "var(--ink-2)" }}>{rejected.length} rejected proposal{rejected.length === 1 ? "" : "s"} kept in the audit log.</section>}
    </div>
  );
}
