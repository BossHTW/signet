import { computeMetrics, plantedStatus } from "@/lib/metrics";
import Link from "next/link";
import { OUTCOME_WORD, TRIGGER } from "@/lib/labels";
import type { TriggerCode } from "@/db/types";

function inHundred(pct: number) {
  return `${Math.round(pct)} in 100`;
}

export default function MetricsPage() {
  const m = computeMetrics();
  const planted = plantedStatus();
  const tiles: [string, string, string?][] = [
    ["Requests processed", String(m.processed)],
    ["Verified, batch-eligible", inHundred(m.readyPct), "clean on every check · certified in sampled batches"],
    ["Opened one by one", inHundred(m.escalatedPct), "a flag, a limit, or a split"],
    ["Payments sent autonomously", String(m.autonomousPayments), "by design: a named person certifies, another releases"],
    ["Certified · attested · released", `${m.certified} · ${m.attested} · ${m.released}`, "two humans on every dollar"],
    ["Denied", inHundred(m.deniedPct), "always by a person, with a reason"],
    ["Median time to verify", `${(m.medianDecisionMs / 1000).toFixed(1)} s`],
    ["Planted anomalies caught", `${m.anomaliesCaught} of ${m.anomaliesPlanted}`],
    ["Staff hours saved per 100", `${m.staffHoursSavedPer100} h`, m.assumptions.staffHoursSavedPer100],
    ["Model calls · cache hits", `${m.llmCalls} · ${m.llmCacheHits}`, `est. spend $${m.spendUsd} · mode ${m.mode}`],
    ["Public records on file", String(m.publicRecordsCached), `Bright Data · ${m.publicCalls} live calls this session`],
    ["Memory", m.memorySource, "precedents · grant clauses · vendor aliases"],
  ];
  return (
    <div className="grid gap-6">
      <div>
        <div className="kicker mb-2">Measured, not claimed</div>
        <h1 className="display-std text-[28px]">Metrics</h1>
        <p className="muted mt-2">Measured on the current database. Assumptions are labeled.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
        {tiles.map(([label, value, note]) => (
          <div key={label} className="card p-4">
            <div className="kicker">{label}</div>
            <div className="num text-[32px] mt-2">{value}</div>
            {note && <div className="text-[12px] muted mt-2">{note}</div>}
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <section className="card p-4">
          <div className="kicker mb-3">Triggers fired</div>
          <table>
            <tbody>
              {Object.entries(m.caughtByCode).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([k, v]) => (
                <tr key={k}>
                  <td>{TRIGGER[k as TriggerCode]?.title ?? k} <span className="mono text-[11px] faint">{k}</span></td>
                  <td className="text-right tabular">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card p-4">
          <div className="kicker mb-3">The eight planted anomalies</div>
          <table>
            <thead><tr><th>Label</th><th>Outcome</th><th>Codes</th></tr></thead>
            <tbody>
              {planted.map((p) => (
                <tr key={p.requestId}>
                  <td><Link className="underline underline-offset-4" href={`/requests/${p.requestId}`}>{p.label}</Link></td>
                  <td><span className={`chip ${p.outcome === "DENIED" ? "chip-hard" : p.outcome === "READY" ? "chip-verify" : "chip-flag"}`}>{OUTCOME_WORD[p.outcome] ?? p.outcome}{p.decidedBy === "HUMAN" ? " · person" : ""}</span></td>
                  <td className="mono text-[11px] faint">{p.codes.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
