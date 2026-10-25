import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ModeBadge } from "@/components/ModeBadge";
import { NessieInspect } from "@/components/NessieInspect";
import { Seal } from "@/components/Seal";
import { resetDemoAction } from "@/app/actions";
import { readScenario } from "@/lib/demoScenario";
import type { Predicate } from "@/db/types";
import { activateDemoRule, approveLine1, attestDemoSample, certifyDemoBatch, denyAct1, openDemoBatch, releaseDemoBatch, reprocessOne, runAct1, runSix, verifyDemoChain } from "./actions";
import { BillTable, Go, ReprocessFour, ResetButton, type DemoRow } from "./buttons";
import { Checks } from "./checks";

const DENY = "No proof the $50 left the bank. Sent back to the caseworker for the bank statement.";
const APPROVE = "Agency-sponsored Mint Mobile family plan; one $30 line per client is expected.";

function say(p: Predicate): string {
  if ("all" in p) return p.all.map(say).join(" and ");
  if ("any" in p) return p.any.map(say).join(" or ");
  if ("not" in p) return `not (${say(p.not)})`;
  return `${p.field} ${p.op} ${JSON.stringify(p.value)}`;
}

export default async function DemoPage({ searchParams }: { searchParams: Promise<{ reset?: string; verified?: string }> }) {
  const sp = await searchParams;
  const scenario = readScenario();
  if (!scenario) return <p>The demo snapshot is not on disk yet. Run <span className="mono">npm run demo:snapshot</span>.</p>;

  const ids = [scenario.act1, ...scenario.mint, scenario.reused];
  const requests = db.select().from(schema.requests).where(inArray(schema.requests.id, ids)).all();
  const byId = new Map(requests.map((r) => [r.id, r]));
  const act = byId.get(scenario.act1);
  if (!act || scenario.mint.some((id) => !byId.get(id)) || !byId.get(scenario.reused)) {
    return <p>This database does not contain the demo requests. Start from a copy of <span className="mono">data/demo-snapshot.db</span>.</p>;
  }

  const docs = db.select().from(schema.documents).where(inArray(schema.documents.requestId, ids)).all();
  const docOf = new Map(docs.map((d) => [d.requestId, d]));
  const decisions = db.select().from(schema.decisions).where(inArray(schema.decisions.requestId, ids)).all();
  const decOf = new Map(decisions.map((d) => [d.requestId, d]));
  const clients = db.select().from(schema.clients).where(inArray(schema.clients.id, requests.map((r) => r.clientId))).all();
  const clientName = new Map(clients.map((c) => [c.id, c.displayName]));
  const grants = db.select().from(schema.grantStreams).all();
  const actDec = decOf.get(act.id);
  const line1 = decOf.get(scenario.mint[0]);
  const proposal = line1 ? db.select().from(schema.ruleProposals).where(eq(schema.ruleProposals.sourceDecisionId, line1.id)).get() : undefined;
  const sixReady = scenario.mint.slice(1).every((id) => ["READY", "APPROVED", "RELEASED"].includes(byId.get(id)?.status ?? ""));
  const anyNew = [...scenario.mint, scenario.reused].some((id) => !decOf.get(id));

  let step = 1;
  if (actDec?.decidedBy === "SYSTEM") step = 2;
  else if (actDec?.outcome === "DENIED" && anyNew) step = 3;
  else if (actDec?.outcome === "DENIED" && line1?.decidedBy === "SYSTEM") step = 4;
  else if (actDec?.outcome === "DENIED" && line1 && !sixReady) step = 5;
  else if (actDec) step = 6;

  const rows: DemoRow[] = [...scenario.mint.map((id, i) => ({ id, line: `Line ${i + 1}` })), { id: scenario.reused, line: "Same receipt" }].map(({ id, line }) => {
    const req = byId.get(id)!;
    const dec = decOf.get(id);
    const byHash = dec?.triggers.some((t) => t.code === "DUP-HIT" && t.evidence?.byHash === true);
    return { id, line, client: clientName.get(req.clientId) ?? req.clientId, outcome: dec?.outcome ?? req.status, triggers: dec?.triggers ?? [], note: byHash ? "Identical document — no rule can waive this." : "" };
  });

  const batch = db.select().from(schema.releaseBatches).all().find((b) => b.itemIds.some((id) => ids.includes(id)));
  const payments = batch?.status === "RELEASED"
    ? db.select().from(schema.auditEvents).where(eq(schema.auditEvents.type, "PAYMENT_SENT")).all().filter((e) => e.requestId && batch.itemIds.includes(e.requestId))
    : [];
  const actDoc = docOf.get(act.id);
  const verified = sp.verified && batch?.status === "RELEASED";

  return (
    <div className="grid gap-8 max-w-3xl">
      <header className="grid gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="display-std text-[32px] leading-tight">Where did the $50 go?</h1>
          <ModeBadge />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[1, 2, 3, 4, 5, 6].map((n) => <span key={n} className={`chip ${n === step ? "chip-flag" : "chip-grey"}`}>{n}</span>)}
          <form action={resetDemoAction} className="ml-auto"><ResetButton /></form>
        </div>
        <p className="text-[15px] muted">You play both people here. In production these are two separate logins.</p>
        {sp.reset === "wait" && <p className="text-[14px]">A reset just ran. Wait a minute, then reset again.</p>}
      </header>

      {step === 1 && (
        <section className="grid gap-5">
          <div className="kicker">1 · The request</div>
          <div className="card p-6 grid gap-3">
            <div className="text-[15px]">{clientName.get(act.clientId)} · utilities · $50.00</div>
            <p>{act.caseNote}</p>
            <pre className="mono text-[13px] whitespace-pre-wrap p-4 rounded-lg" style={{ background: "var(--paper)" }}>{actDoc?.rawText}</pre>
            <Fields extracted={actDoc?.extracted ?? null} model={actDoc?.model ?? null} />
          </div>
          <Go action={runAct1} label="Run Signet's checks" pending="Checking the bank…" />
        </section>
      )}

      {step === 2 && actDec && (
        <section className="grid gap-5">
          <div className="kicker">2 · A person decides</div>
          <Checks vendorName={act.vendorNameRaw} decision={{ requestId: act.id, outcome: actDec.outcome, triggers: actDec.triggers, allocation: actDec.allocation, caseSummary: actDec.caseSummary, policyResult: actDec.policyResult, matchResult: actDec.matchResult, extracted: actDoc?.extracted ?? null, model: actDoc?.model ?? null }} grants={grants} />
          <blockquote className="text-[17px]" style={{ maxWidth: "62ch" }}>&ldquo;{DENY}&rdquo;</blockquote>
          <Go action={denyAct1} label="Deny" pending="Recording the decision…" />
        </section>
      )}

      {step === 3 && actDec?.seal && (
        <section className="grid gap-5">
          <div className="kicker">3 · Six bills from one family plan</div>
          <div className="flex items-start gap-4">
            <Seal seal={actDec.seal} outcome="DENIED" />
            <p style={{ maxWidth: "52ch" }}>Signet never denies on its own. A named person did, and the reason is on the record.</p>
          </div>
          <BillTable rows={rows} />
          <Go action={runSix} label="Run checks on all six" pending="Checking the bank…" />
        </section>
      )}

      {step === 4 && (
        <section className="grid gap-5">
          <div className="kicker">4 · Approve the pattern once</div>
          <BillTable rows={rows} />
          <blockquote className="text-[17px]" style={{ maxWidth: "62ch" }}>&ldquo;{APPROVE}&rdquo;</blockquote>
          <Go action={approveLine1} label="Approve line 1" pending="Recording the approval…" />
        </section>
      )}

      {step === 5 && proposal && (
        <section className="grid gap-5">
          <div className="kicker">5 · A second person switches it on</div>
          {proposal.status === "PROPOSED" && <BillTable rows={rows} />}
          <div className="card p-6 grid gap-2">
            <div className="text-[15px]">{proposal.action === "allow_within_limit" ? "Allow within the existing limits" : proposal.action}</div>
            <p className="text-[15px]">{say(proposal.predicate)}</p>
            <p className="muted">Replay: would clear {proposal.replayImpact?.wouldChange ?? 0}.</p>
          </div>
          {proposal.status === "PROPOSED"
            ? <Go action={activateDemoRule} label="Activate rule" pending="Switching the rule on…" />
            : <ReprocessFour rows={rows} ids={scenario.mint.slice(1)} action={reprocessOne} />}
        </section>
      )}

      {step === 6 && (
        <section className="grid gap-5">
          <div className="kicker">6 · Two signatures, real money</div>
          <BillTable rows={rows} />
          {!batch && <Go action={openDemoBatch} label="Open the batch" pending="Opening the batch…" />}
          {batch?.status === "OPEN" && batch.sampleIds.some((id) => !batch.attestedIds.includes(id)) && <Go action={attestDemoSample} label="Attest the sample" pending="Recording what you read…" />}
          {batch?.status === "OPEN" && batch.sampleIds.every((id) => batch.attestedIds.includes(id)) && <Go action={certifyDemoBatch} label="Certify" pending="Certifying…" />}
          {batch?.status === "CERTIFIED" && (
            <div className="grid gap-3 justify-items-start">
              <button className="btn btn-lg" disabled>Release</button>
              <p className="text-[15px]">The person who certified can&apos;t release.</p>
              <Go action={releaseDemoBatch} label="Release" pending="Sending the payments…" />
            </div>
          )}
          {batch?.status === "RELEASED" && (
            <div className="grid gap-4">
              {payments.map((e) => {
                const txns = (e.payload as { txns?: { txnId: string; cents: number; raw?: unknown }[] }).txns ?? [];
                return txns.map((t) => (
                  <div key={t.txnId} className="card p-4 grid gap-2">
                    <div className="text-[15px]">Transaction <span className="mono">{t.txnId}</span> · ${(t.cents / 100).toFixed(2)}</div>
                    <NessieInspect raw={t.raw} />
                  </div>
                ));
              })}
              {verified
                ? <p className="text-[17px]">✓ {sp.verified} events, unbroken</p>
                : <Go action={verifyDemoChain} label="Verify the audit chain" pending="Walking the chain…" />}
            </div>
          )}
        </section>
      )}

      {verified && (
        <section className="card p-8 grid gap-3">
          <h2 className="display-std text-[28px]">Claude reads. Code checks. People decide.</h2>
          <div className="flex flex-wrap gap-4 text-[15px]">
            <Link href="/deck" className="underline">Deck</Link>
            <Link href="/memo" className="underline">Memo</Link>
            <Link href="/integrations" className="underline">Integrations</Link>
            <Link href="/today" className="underline">Today</Link>
          </div>
        </section>
      )}
    </div>
  );
}

function Fields({ extracted, model }: { extracted: { vendorName?: { value: string; confidence: number }; amountCents?: { value: number; confidence: number }; date?: { value: string; confidence: number }; lineItems?: { value: { label: string }[]; confidence: number } } | null; model: string | null }) {
  if (!extracted) return <p className="muted">Claude has not read this yet.</p>;
  const rows: [string, string, number][] = [];
  if (extracted.vendorName) rows.push(["Paid to", extracted.vendorName.value, extracted.vendorName.confidence]);
  if (extracted.amountCents) rows.push(["Amount", `$${(extracted.amountCents.value / 100).toFixed(2)}`, extracted.amountCents.confidence]);
  if (extracted.date) rows.push(["Date", extracted.date.value, extracted.date.confidence]);
  if (extracted.lineItems) rows.push(["Line items", extracted.lineItems.value.map((l) => l.label).join(", "), extracted.lineItems.confidence]);
  return (
    <div className="grid gap-1">
      <div className="kicker">Claude · {model}</div>
      {rows.map(([k, v, c]) => <div key={k} className="flex justify-between gap-4 text-[15px]"><span>{k}: {v}</span><span className="faint tabular">{Math.round(c * 100)}%</span></div>)}
    </div>
  );
}
