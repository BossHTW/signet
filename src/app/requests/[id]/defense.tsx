"use client";
import { useEffect, useState, useTransition } from "react";
import type { Explanation } from "@/lib/pipeline";

// "Explain this to me": each flag → what it means, what we saw, the rule it comes from, how a supervisor handled it before, what to look at.
export function DefenseButton({ requestId, auto = false }: { requestId: string; auto?: boolean }) {
  const [ex, setEx] = useState<Explanation | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const load = () => start(async () => {
    const r = await fetch(`/api/requests/${requestId}/defend`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) { setErr(j.error ?? "Could not explain this record."); return; }
    setEx(j as Explanation);
  });
  useEffect(() => { if (auto) load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [auto, requestId]);
  return (
    <div className="grid gap-3">
      {!ex && <button className="btn" disabled={pending} onClick={load}>{pending ? "Reading the record…" : "Explain this to me"}</button>}
      {err && <div className="text-sm" style={{ color: "var(--flag)" }}>{err}</div>}
      {ex && (
        <div className="grid gap-3">
          <p className="text-[15px] leading-relaxed">{ex.headline}</p>
          {ex.summary && <p className="text-sm leading-relaxed p-3 rounded-lg" style={{ background: "var(--paper)" }}>{ex.summary} <span className="faint">— drafted by Claude from the record</span></p>}
          {ex.flags.map((f) => (
            <div key={f.code} className="grid gap-1.5 p-3 rounded-lg" style={{ border: "1px solid var(--line)" }}>
              <div className="flex items-center gap-2"><span className="font-semibold">{f.title}</span><span className="mono text-[11px] faint">{f.code}</span></div>
              <div className="text-sm"><span className="muted">What we saw · </span>{f.saw}</div>
              <div className="text-sm"><span className="muted">What it means · </span>{f.means}</div>
              {f.rule && <div className="text-sm"><span className="muted">Where the rule comes from · </span><span className="font-medium">{f.rule.cite}:</span> {f.rule.text}</div>}
              {f.precedent && <div className="text-sm"><span className="muted">How a supervisor handled a similar case · </span><span className={`chip ${f.precedent.outcome === "DENIED" ? "chip-hard" : "chip-ok"}`} style={{ fontSize: ".68rem" }}>{f.precedent.outcome === "DENIED" ? "denied" : "approved"}</span> {f.precedent.text}</div>}
              <div className="text-sm"><span className="muted">Look at · </span>{f.look}</div>
            </div>
          ))}
          {ex.clean.length > 0 && <div className="text-sm"><span className="muted">What passed · </span>{ex.clean.join(" ")}</div>}
          <div className="text-[11px] faint" title={ex.memorySource === "LOCAL-FALLBACK" ? ex.memoryError : undefined} style={ex.memorySource === "LOCAL-FALLBACK" ? { color: "var(--ink-3)" } : undefined}>Rules and precedents from <span className="mono">{ex.memorySource}</span>: the procedures manual, HUD and 2 CFR excerpts, and last year&rsquo;s supervisor decisions.</div>
        </div>
      )}
    </div>
  );
}
