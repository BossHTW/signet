import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { openBatchAction, processAllAction } from "@/app/actions";
import { openBatchPreview } from "@/lib/pipeline";
import { currentHuman } from "@/lib/role";
import { ROLES } from "@/db/types";
import { IntegrationStrip } from "@/components/IntegrationStrip";

export default async function Today() {
  const me = await currentHuman();
  const all = db.select({ status: schema.requests.status }).from(schema.requests).all();
  const n = (s: string) => all.filter((x) => x.status === s).length;
  const ready = openBatchPreview();
  const open = db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.status, "OPEN")).get();
  const certified = db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.status, "CERTIFIED")).all();
  const released = db.select().from(schema.releaseBatches).where(eq(schema.releaseBatches.status, "RELEASED")).all();
  const paidCents = db.select({ c: schema.requests.requestedCents }).from(schema.requests).where(inArray(schema.requests.status, ["RELEASED"])).all().reduce((s, x) => s + x.c, 0);
  const sampleLeft = open ? open.sampleIds.filter((id) => !open.attestedIds.includes(id)).length : 0;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  type Step = { n: number; title: string; detail: string; count?: number; state: "done" | "now" | "wait"; action?: React.ReactNode; role?: "supervisor" | "finance" };
  const steps: Step[] = [];
  steps.push({ n: 1, title: "Let the agent read and check", detail: n("NEW") ? `${n("NEW")} new requests to read, check against the grants, and sort.` : `${all.length - n("NEW")} requests read and checked. The agent sorts; it never pays.`, count: n("NEW"), state: n("NEW") ? "now" : "done",
    action: n("NEW") ? <form action={processAllAction}><button className="btn btn-primary btn-lg">Run the agent</button></form> : undefined });
  steps.push({ n: 2, title: "Decide the exceptions", detail: n("ESCALATED") ? `${n("ESCALATED")} requests where a check found something. One at a time, with the reason in plain words.` : "No exceptions waiting.", count: n("ESCALATED"), state: n("ESCALATED") ? (n("NEW") ? "wait" : "now") : "done", role: "supervisor",
    action: n("ESCALATED") && !n("NEW") ? <Link href="/review?step=decide" className="btn btn-primary btn-lg">Start deciding</Link> : undefined });
  const sampleState: Step["state"] = open ? "now" : ready.count ? (n("NEW") ? "wait" : "now") : certified.length || released.length ? "done" : "wait";
  steps.push({ n: 3, title: "Read the sample, then certify", detail: open ? `Batch ${open.id} is open: ${open.sampleIds.length - sampleLeft} of ${open.sampleIds.length} sampled items read.` : ready.count ? `${ready.count} verified items (${money(ready.totalCents)}) are ready for a release batch. You will read a random sample of ${Math.max(3, Math.ceil(ready.count * 0.1))}${ready.dualControl ? ` plus ${ready.dualControl} larger item${ready.dualControl === 1 ? "" : "s"}` : ""}.` : "Nothing verified is waiting for a batch.", count: open ? sampleLeft : ready.count, state: sampleState, role: "supervisor",
    action: open ? <Link href="/review?step=sample" className="btn btn-primary btn-lg">{sampleLeft ? "Continue reading" : "Certify the batch"}</Link> : ready.count && !n("NEW") ? <form action={openBatchAction}><button className="btn btn-primary btn-lg">Open a release batch</button></form> : undefined });
  steps.push({ n: 4, title: "Release the money", detail: certified.length ? `Batch ${certified[0].id}: ${certified[0].itemIds.length} payments, ${money(certified[0].totalCents)}, certified by ${certified[0].certifiedBy}. A different person releases.` : released.length ? `${released.length} batch${released.length === 1 ? "" : "es"} released this week.` : "Waiting for a certified batch.", count: certified.length, state: certified.length ? "now" : released.length ? "done" : "wait", role: "finance",
    action: certified.length ? <Link href={`/batches/${certified[0].id}`} className="btn btn-seal btn-lg">Review and release</Link> : undefined });

  return (
    <div className="grid gap-8 max-w-3xl">
      <div>
        <h1 className="display-std text-[28px]">{greet}, {ROLES[me.role].title.replace(/ \(.*\)/, "")}.</h1>
        <p className="muted mt-2">Here is the work in order. Each step hands into the next; open a record only when a card asks you to.</p>
      </div>

      <IntegrationStrip />

      <ol className="grid gap-2">
        {steps.map((s) => {
          const mine = !s.role || s.role === me.role;
          return (
            <li key={s.n} className={`card p-4 grid md:grid-cols-[40px_1fr_auto] gap-4 items-center ${s.state === "wait" ? "opacity-60" : ""}`} style={{ borderColor: s.state === "now" ? "var(--ink)" : undefined }}>
              <div className="grid place-items-center w-10 h-10 rounded-full font-semibold text-[15px]" style={{ background: s.state === "done" ? "var(--ok-soft)" : s.state === "now" ? "var(--ink)" : "var(--paper)", color: s.state === "done" ? "var(--ok)" : s.state === "now" ? "var(--card)" : "var(--ink-2)", border: s.state === "wait" ? "1px solid var(--line)" : "none" }} aria-label={s.state === "done" ? "Done" : s.state === "now" ? "Do this now" : "Waiting"}>{s.state === "done" ? "✓" : s.n}</div>
              <div>
                <div className="flex items-center gap-2 flex-wrap"><h2 className="font-semibold text-[16px]">{s.title}</h2>{s.role && <span className="chip chip-grey">{ROLES[s.role].title.replace(/ \(.*\)/, "")}</span>}</div>
                <p className="text-[14px] muted mt-1">{s.detail}</p>
              </div>
              <div className="md:justify-self-end">
                {s.state === "now" && s.action && mine && s.action}
                {s.state === "now" && s.action && !mine && <span className="text-[13px] muted">Switch role in the header to do this step.</span>}
              </div>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Stat label="Paid this week" value={money(paidCents)} note={`${n("RELEASED")} payments · two named people on each`} />
        <Stat label="Denied" value={String(n("DENIED"))} note="always by a person, with a reason" />
        <Stat label="Sent without two humans" value="0" note="by design" />
      </div>
      <p className="text-[14px] muted">Want the whole list? <Link href="/queue" className="underline underline-offset-4">All requests</Link> · <Link href="/batches" className="underline underline-offset-4">Batches</Link></p>
    </div>
  );
}
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="card p-4"><div className="kicker">{label}</div><div className="num text-[32px] mt-2">{value}</div><div className="text-[12px] muted mt-2">{note}</div></div>;
}
