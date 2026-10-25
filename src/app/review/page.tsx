import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { Money, money } from "@/components/Money";
import { TriggerChip } from "@/components/TriggerChip";
import { Seal } from "@/components/Seal";
import { Hotkeys } from "@/components/Hotkeys";
import { attestAction, certifyBatchAction, decideAction } from "@/app/actions";
import { explain } from "@/lib/pipeline";
import { currentHuman } from "@/lib/role";
import { confidenceWord, FIELD_LABEL } from "@/lib/labels";
import type { Extracted, Field } from "@/db/types";

type Step = "decide" | "sample";

// One card at a time. Decide the exceptions, then read the sample. The full record opens only when a card asks for it.
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ step?: string; skip?: string }> }) {
  const sp = await searchParams;
  const me = await currentHuman();
  const step: Step = sp.step === "sample" ? "sample" : "decide";
  const skipped = (sp.skip ?? "").split(",").filter(Boolean);

  if (me.role !== "supervisor") {
    return <div className="deck grid gap-4"><div className="deck-card p-8"><h1 className="display-std text-2xl">Review is the Program Supervisor&rsquo;s step.</h1><p className="muted mt-2">You are signed in as Finance. Finance releases certified batches from <Link className="underline" href="/batches">Batches</Link>. Switch role in the header to review.</p></div></div>;
  }

  // ---- queue for this step ----
  let ids: string[] = [];
  let total = 0;
  let batch = null as typeof schema.releaseBatches.$inferSelect | null;
  if (step === "decide") {
    ids = db.select({ id: schema.requests.id }).from(schema.requests).where(eq(schema.requests.status, "ESCALATED")).orderBy(schema.requests.requestedAt).all().map((x) => x.id);
    total = ids.length;
  } else {
    batch = db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.status, "OPEN")).get() ?? null;
    if (!batch) redirect("/today");
    ids = batch.sampleIds.filter((id) => !batch!.attestedIds.includes(id));
    total = batch.sampleIds.length;
  }
  const remaining = ids.filter((id) => !skipped.includes(id));
  const current = remaining[0] ?? ids[0] ?? null; // skipped ones come back around
  const done = total - ids.length;

  // ---- finished this step ----
  if (!current) {
    return (
      <div className="deck grid gap-4">
        <Progress label={step === "decide" ? "Exceptions" : "Sample"} done={total} total={total} />
        <div className="deck-card p-8 grid gap-4">
          {step === "decide" ? (
            <><h1 className="display-std text-2xl">Exceptions decided.</h1><p className="muted">Each decision has a reason on file and a proposed rule for Finance to look at. Next: the release batch.</p>
              <div className="flex gap-3"><Link href="/today" className="btn btn-primary btn-lg">Back to today</Link><Link href="/rules" className="btn btn-lg">See proposed rules</Link></div></>
          ) : (
            <><h1 className="display-std text-2xl">Sample read. Certify the batch.</h1>
              <p className="muted">{batch!.itemIds.length} payments, <Money cents={batch!.totalCents} />. You opened and attested {batch!.attestedIds.length} of them. Certifying signs: &ldquo;the items in this batch are proper for payment under the funding rules shown.&rdquo; Finance releases the money.</p>
              <form action={certifyBatchAction} className="flex gap-3 items-center"><input type="hidden" name="batchId" value={batch!.id} /><button className="btn btn-primary btn-lg">Certify {batch!.itemIds.length} payments</button><Link href={`/batches/${batch!.id}`} className="btn btn-lg">See the whole batch</Link></form></>
          )}
        </div>
      </div>
    );
  }

  // ---- the card ----
  const r = db.select().from(schema.requests).where(eq(schema.requests.id, current)).get()!;
  const d = db.select().from(schema.decisions).where(eq(schema.decisions.requestId, current)).get()!;
  const c = db.select().from(schema.clients).where(eq(schema.clients.id, r.clientId)).get()!;
  const doc = db.select().from(schema.documents).where(eq(schema.documents.requestId, current)).get();
  const ex = await explain(current);
  const ext = doc?.extracted ?? null;
  const skipNext = [...skipped, current].join(",");
  const hard = d.triggers.some((t) => ["DUP-HIT", "POL-HARD", "VENDOR-FLAG"].includes(t.code));

  return (
    <div className="deck grid gap-4">
      <Progress label={step === "decide" ? "Exceptions" : "Reading the sample"} done={done} total={total} />
      <article className="deck-card spine" style={{ ["--spine" as string]: hard ? "var(--flag)" : "var(--ink)" }}>
        <div className="p-8 grid gap-6">
          <header className="flex items-start gap-6 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="num text-[48px]"><Money cents={r.requestedCents} /></div>
              <div className="text-[15px] mt-2">{r.category} · to <b>{r.vendorNameRaw}</b> for <b>{c.displayName}</b></div>
              <div className="text-[13px] muted mt-1">Requested {r.requestedAt} by {r.caseManagerId}</div>
              <div className="text-[15px] muted mt-2">&ldquo;{r.caseNote}&rdquo;</div>
            </div>
            <div className="shrink-0 grid gap-3 justify-items-end">
              <Seal seal={d.seal} outcome={d.outcome} status={r.status} size={88} />
              <Link href={`/requests/${r.id}${batch ? `?batch=${batch.id}` : ""}`} className="text-[13px] muted underline underline-offset-4" id="k-open">Open full record</Link>
            </div>
          </header>

          {step === "sample" ? (
            <section className="grid gap-2">
              <div className="kicker">Every check passed</div>
              <ul className="grid gap-1 text-sm">{ex.clean.map((x, i) => <li key={i} className="flex gap-2"><span style={{ color: "var(--ok)" }}>✓</span>{x}</li>)}</ul>
            </section>
          ) : (
            <section className="grid gap-1">
              <div className="kicker">{d.triggers.length === 1 ? "One thing to look at" : `${d.triggers.length} things to look at`}</div>
              {d.triggers.map((t, i) => <TriggerChip key={i} t={t} withReason />)}
              {ex.flags.some((f) => f.rule || f.precedent) && (
                <div className="grid gap-2 mt-2">
                  {ex.flags.filter((f) => f.rule || f.precedent).slice(0, 2).map((f) => (
                    <div key={f.code} className="text-sm field grid gap-1">
                      {f.rule && <div><span className="font-medium" style={{ color: "var(--verify)" }}>{f.rule.cite}</span> · {f.rule.text}</div>}
                      {f.precedent && <div><span className={`chip ${f.precedent.outcome === "DENIED" ? "chip-hard" : "chip-ok"}`} style={{ fontSize: ".66rem" }}>a supervisor once {f.precedent.outcome === "DENIED" ? "denied" : "approved"}</span> {f.precedent.text}</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="grid md:grid-cols-2 gap-4">
            <div className="grid gap-2 content-start">
              <div className="kicker">The document <span className="normal-case tracking-normal font-normal faint">· {doc?.kind}{doc?.imagePath ? " · photo" : ""}</span></div>
              {doc?.imagePath ? <img alt="document" src={`/api/doc-image?id=${doc.id}`} className="rounded-lg border" style={{ borderColor: "var(--line)", maxHeight: 220, objectFit: "contain" }} /> : <pre className="mono text-[11px] whitespace-pre-wrap p-3 rounded-lg field" style={{ maxHeight: 220, overflow: "auto" }}>{doc?.rawText ?? "(no text)"}</pre>}
            </div>
            <div className="grid gap-2 content-start">
              <div className="kicker">What the agent read <span className="normal-case tracking-normal font-normal faint">· amber means read it yourself</span></div>
              {ext ? <Fields ext={ext} /> : <div className="text-sm muted">Not read yet.</div>}
            </div>
          </section>
        </div>

        <footer className="px-8 py-5 grid gap-4" style={{ borderTop: "1px solid var(--line)", background: "var(--paper)", borderRadius: "0 0 12px 12px" }}>
          {step === "sample" ? (
            <div className="flex flex-wrap items-center gap-3">
              <form action={attestAction}><input type="hidden" name="batchId" value={batch!.id} /><input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="back" value={`/review?step=sample${skipped.length ? `&skip=${skipped.join(",")}` : ""}`} />
                <button id="k-yes" className="btn btn-primary btn-lg">Looks right, I read it <kbd>→</kbd></button></form>
              <Link id="k-no" href={`/requests/${r.id}?batch=${batch!.id}`} className="btn btn-lg">Needs a closer look <kbd>←</kbd></Link>
              <Link href={`/review?step=sample&skip=${skipNext}`} className="btn btn-quiet ml-auto">Skip for now</Link>
              <p className="w-full text-xs muted">Attesting records your name and &ldquo;I opened this record, read the document and the checks, and certify the facts recited.&rdquo;</p>
            </div>
          ) : (
            <form action={decideAction} className="grid gap-3">
              <input type="hidden" name="requestId" value={r.id} /><input type="hidden" name="flow" value="1" />
              <div className="grid md:grid-cols-[1fr_240px] gap-3">
                <div><label>Your reason (required; it becomes a proposed rule)</label><textarea name="rationale" rows={2} required placeholder={hard ? "e.g. Same receipt filed for two clients; asked the case manager which account is theirs." : "e.g. Private landlord, agreement on file; confirmed by phone."} /></div>
                <div><label>Which flag are you resolving?</label><select name="chosenTrigger" defaultValue={d.triggers[0]?.code}>{d.triggers.map((t, i) => <option key={i} value={t.code}>{ex.flags[i]?.title ?? t.code}</option>)}</select></div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button name="outcome" value="APPROVED" className="btn btn-primary btn-lg">Approve &amp; certify</button>
                <button name="outcome" value="DENIED" className="btn btn-seal btn-lg">Deny, with this reason</button>
                <Link href={`/review?step=decide&skip=${skipNext}`} className="btn btn-quiet ml-auto">Skip for now</Link>
                <p className="w-full text-xs muted">Approving certifies the item; it joins the next release batch. Only a person approves or denies.</p>
              </div>
            </form>
          )}
        </footer>
      </article>
      <Hotkeys map={step === "sample" ? { ArrowRight: "k-yes", ArrowLeft: "k-no", o: "k-open" } : { o: "k-open" }} />
    </div>
  );
}

function Progress({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between text-sm"><span className="font-medium">{label}</span><span className="muted">{Math.min(done + 1, total)} of {total}</span></div>
      <div className="progress"><div style={{ width: `${total ? (done / total) * 100 : 0}%` }} /></div>
    </div>
  );
}

function Fields({ ext }: { ext: Extracted }) {
  const rows: [string, Field<unknown> | undefined, (v: unknown) => string][] = [
    [FIELD_LABEL.vendorName, ext.vendorName, String],
    [FIELD_LABEL.amountCents, ext.amountCents, (v) => money(v as number)],
    [FIELD_LABEL.date, ext.date, String],
    [FIELD_LABEL.clientNameOnDoc, ext.clientNameOnDoc, String],
  ];
  return (
    <div className="grid gap-1.5">
      {rows.filter(([, f]) => f).map(([label, f, fmt]) => {
        const cw = confidenceWord(f!.confidence);
        return (
          <div key={label} className={`field flex items-baseline justify-between gap-3 ${cw.low ? "field-low" : ""}`} title={`${Math.round(f!.confidence * 100)}% confidence`}>
            <div><div className="text-[11px] muted">{label}</div><div className="font-medium">{fmt(f!.value)}</div></div>
            <div className="text-[11px] shrink-0" style={{ color: cw.low ? "var(--flag)" : "var(--ink-3)" }}>{cw.word}</div>
          </div>
        );
      })}
      {ext.lineItems && ext.lineItems.value.length > 0 && (
        <div className={`field ${confidenceWord(ext.lineItems.confidence).low ? "field-low" : ""}`}>
          <div className="text-[11px] muted mb-1">{FIELD_LABEL.lineItems}</div>
          {ext.lineItems.value.map((l, i) => <div key={i} className="flex justify-between text-sm"><span>{l.label}{l.flag && l.flag !== "other" && <span className="chip chip-hard ml-2" style={{ fontSize: ".62rem" }}>{l.flag.replace(/_/g, " ")}</span>}</span><span className="mono">{money(l.cents)}</span></div>)}
        </div>
      )}
    </div>
  );
}
