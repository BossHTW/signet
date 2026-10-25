import Link from "next/link";
import { precedents } from "@/lib/pipeline";

// What the agent remembers that is like this request: how supervisors decided before, the rule text, the nearest known vendors.
export async function Precedents({ requestId }: { requestId: string }) {
  const p = await precedents(requestId);
  if (!p.decisions.length && !p.clauses.length) return null;
  return (
    <section className="card p-5 grid md:grid-cols-3 gap-5">
      <div className="md:col-span-3 flex items-baseline gap-3">
        <h2 className="font-semibold text-[16px]">What the office remembers</h2>
        <span className="text-xs faint">similar cases, the rules behind the flags, known vendors · <span title={p.source === "LOCAL-FALLBACK" ? p.error : undefined} style={p.source === "LOCAL-FALLBACK" ? { color: "var(--ink-3)" } : undefined}>{p.source}</span></span>
      </div>
      <div>
        <div className="kicker mb-2">How supervisors decided before</div>
        {p.decisions.length === 0 && <div className="text-sm muted">No similar case yet.</div>}
        {p.decisions.map((h) => {
          const historical = h.metadata?.historical === "true";
          const text = h.text.replace(/^.*?Outcome (APPROVED|DENIED|READY|ESCALATED) by [^:]+: /, "").replace(/^.*?Outcome (READY|ESCALATED) by SYSTEM\.?/, "");
          const body = <>
            <div className="flex items-center gap-2 mb-1"><span className={`chip ${h.metadata?.outcome === "DENIED" ? "chip-hard" : h.metadata?.outcome === "APPROVED" ? "chip-ok" : "chip-verify"}`} style={{ fontSize: ".68rem" }}>{(h.metadata?.outcome ?? "").toLowerCase()}</span><span className="text-[11px] faint">{historical ? `${h.metadata?.when} · ${h.metadata?.category}` : h.metadata?.decidedBy?.startsWith("HUMAN") ? "this quarter" : "system"}</span></div>
            <div className="text-sm leading-snug">{text.slice(0, 220)}{text.length > 220 ? "…" : ""}</div>
          </>;
          return historical ? <div key={h.id} className="field mb-2">{body}</div> : <Link key={h.id} href={`/requests/${h.id}`} className="block field mb-2 hover:underline">{body}</Link>;
        })}
      </div>
      <div>
        <div className="kicker mb-2">The rules behind this</div>
        {p.clauses.map((h) => (
          <div key={h.id} className="field mb-2">
            <div className="text-[11px] font-medium mb-1" style={{ color: "var(--verify)" }}>{h.metadata?.source === "regulation" ? h.metadata.grant : h.metadata?.source === "manual" ? `Procedures manual ${h.metadata.grant}` : `Grant ${h.metadata?.grant}`} · {h.metadata?.clause}</div>
            <div className="text-sm leading-snug">{h.text.replace(/^(Procedures manual §[\d.]+ [^.]+\. |\S+ CFR [^ ]+ [^.]+\. )/, "")}</div>
          </div>
        ))}
      </div>
      <div>
        <div className="kicker mb-2">Closest known vendors</div>
        {p.vendors.map((h) => (
          <div key={h.id} className="field mb-2 flex justify-between gap-3"><span className="text-sm">{h.metadata?.legalName}</span><span className="text-xs faint">{Math.round(h.score * 100)}% alike</span></div>
        ))}
      </div>
    </section>
  );
}
