import { computeMetrics, plantedStatus } from "@/lib/metrics";
import Link from "next/link";

export default function MetricsPage() {
  const m = computeMetrics();
  const planted = plantedStatus();
  const tiles: [string, string, string?][] = [
    ["Requests processed", String(m.processed)],
    ["Auto-approved", `${m.autoApprovedPct}%`, "paid with no human touch"],
    ["Escalated to a human", `${m.escalatedPct}%`],
    ["Denied", `${m.deniedPct}%`, "always by a person"],
    ["Median time to decision", `${(m.medianDecisionMs / 1000).toFixed(1)} s`],
    ["Planted anomalies caught", `${m.anomaliesCaught} / ${m.anomaliesPlanted}`],
    ["Staff hours saved per 100", `${m.staffHoursSavedPer100} h`, m.assumptions.staffHoursSavedPer100],
    ["Model calls · cache hits", `${m.llmCalls} · ${m.llmCacheHits}`, `est. spend $${m.spendUsd} · mode ${m.mode}`],
  ];
  return (
    <div className="grid gap-5">
      <div><div className="kicker mb-2">Measured, not claimed</div><h1 className="display" style={{ fontSize: 64 }}>Metrics.</h1><p className="serif text-lg mt-2" style={{ color: "var(--ink2)" }}>Measured on the current database. Assumptions are labeled.</p></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="card p-5"><div className="kicker">{label}</div><div className="num text-5xl mt-2">{value}</div>{note && <div className="serif italic text-xs mt-2" style={{ color: "var(--ink2)" }}>{note}</div>}</div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <section className="card p-5"><div className="kicker mb-3">Triggers fired</div>
          <table className="ui"><tbody>{Object.entries(m.caughtByCode).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k, v]) => <tr key={k}><td className="mono">{k}</td><td className="text-right">{v}</td></tr>)}</tbody></table></section>
        <section className="card p-5"><div className="kicker mb-3">The eight planted anomalies</div>
          <table className="ui"><thead><tr><th>Label</th><th>Outcome</th><th>Codes</th></tr></thead><tbody>
            {planted.map((p) => <tr key={p.requestId}><td><Link className="underline" href={`/requests/${p.requestId}`}>{p.label}</Link></td><td><span className={`chip ${p.outcome === "APPROVED" && p.decidedBy === "SYSTEM" ? "chip-hard" : "chip-ok"}`}>{p.outcome}{p.decidedBy === "HUMAN" ? " · human" : ""}</span></td><td className="mono text-[11px]">{p.codes.join(", ")}</td></tr>)}
          </tbody></table></section>
      </div>
    </div>
  );
}
