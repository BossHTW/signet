import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { verifyChain } from "@/lib/audit";

const COLOR: Record<string, string> = { HUMAN_DECIDED: "chip-hard", RULE_ACTIVATED: "chip-hard", RULE_RETIRED: "chip-hard", VERIFIED_READY: "chip-verify", PAYMENT_SENT: "chip-ok", BATCH_CERTIFIED: "chip-hard", BATCH_RELEASED: "chip-ok", ITEM_ATTESTED: "chip-hard", BATCH_OPENED: "chip-flag", ESCALATED: "chip-flag", RULE_PROPOSED: "chip-flag" };

export default function AuditPage() {
  const rows = db.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.seq)).limit(300).all();
  const v = verifyChain();
  return (
    <div className="grid gap-4">
      <div className="flex items-end gap-4">
        <div><div className="kicker mb-2">Record</div><h1 className="display-std text-[28px]">Audit log.</h1><p className="muted mt-2" style={{ color: "var(--ink-2)" }}>Append-only. Each event hashes the one before it. Nothing here can be edited, including by the agent.</p></div>
        <div className={`ml-auto chip ${v.ok ? "chip-verify" : "chip-hard"}`}>{v.ok ? `Chain verified · ${v.count} events` : `Chain broken at #${v.brokenAt}`}</div>
      </div>
      <div className="card p-2 overflow-hidden">
        <table className="ui">
          <thead><tr><th>#</th><th>When</th><th>Event</th><th>Actor</th><th>Request</th><th>Payload</th><th>Hash</th></tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.seq}>
                <td className="mono text-xs">{e.seq}</td>
                <td className="text-xs" style={{ color: "var(--ink-2)" }}>{e.at.slice(5, 19).replace("T", " ")}</td>
                <td><span className={`chip ${COLOR[e.type] ?? "chip-grey"}`}>{e.type}</span></td>
                <td className="text-xs">{e.actor.startsWith("human") ? e.actor : <span className="muted">{e.actor}</span>}</td>
                <td>{e.requestId ? <Link className="mono text-xs underline" href={`/requests/${e.requestId}`}>{e.requestId}</Link> : "—"}</td>
                <td className="mono text-[11px] max-w-md truncate" title={JSON.stringify(e.payload)}>{JSON.stringify(e.payload).slice(0, 110)}</td>
                <td className="mono text-[11px]" style={{ color: "var(--ink-2)" }}>{e.hash.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
