import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { Money } from "@/components/Money";
import { openBatchAction } from "@/app/actions";
import { openBatchPreview } from "@/lib/pipeline";
import { currentRole } from "@/lib/role";

export default async function BatchesPage() {
  const role = await currentRole();
  const batches = db.select().from(schema.releaseBatches).orderBy(desc(schema.releaseBatches.openedAt)).all();
  const ready = openBatchPreview();
  return (
    <div className="grid gap-6">
      <div className="grid md:grid-cols-[1fr_auto] gap-6 items-end">
        <div><div className="kicker mb-2">Release</div><h1 className="display-std text-[28px]">Two people.<br /><span style={{ color: "var(--ink)" }}>Every dollar.</span></h1>
          <p className="muted mt-3 max-w-2xl" style={{ color: "var(--ink-2)" }}>The system verifies and sorts. A Program Supervisor opens a batch, reads a random sample and certifies it. A different person, the Finance Director, releases the money. Signet never approves, denies, or pays.</p></div>
        {ready.count > 0 && role === "supervisor" && <form action={openBatchAction}><button className="btn btn-primary btn-lg">Open batch · {ready.count} items · <Money cents={ready.totalCents} /></button></form>}
      </div>
      <div className="card p-2">
        <table className="ui">
          <thead><tr><th>Batch</th><th>Status</th><th>Items</th><th>Total</th><th>Sample</th><th>Certified by</th><th>Released by</th></tr></thead>
          <tbody>
            {batches.length === 0 && <tr><td colSpan={7} className="italic text-center py-8" style={{ color: "var(--ink-2)" }}>No batches yet. Run the agent, then open one.</td></tr>}
            {batches.map((b) => (
              <tr key={b.id}>
                <td><Link className="mono underline underline-offset-4" href={`/batches/${b.id}`}>{b.id}</Link></td>
                <td><span className={`chip ${b.status === "RELEASED" ? "chip-ok" : b.status === "CERTIFIED" ? "chip-hard" : "chip-flag"}`}>{b.status === "RELEASED" ? "Released" : b.status === "CERTIFIED" ? "Certified" : "Open"}</span></td>
                <td>{b.itemIds.length}</td><td><Money cents={b.totalCents} /></td>
                <td className="mono text-xs">{b.attestedIds.filter((id) => b.sampleIds.includes(id)).length}/{b.sampleIds.length} attested</td>
                <td className="text-xs">{b.certifiedBy ?? "—"}</td><td className="text-xs">{b.releasedBy ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
