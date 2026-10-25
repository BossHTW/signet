"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

export function Go({ action, label, pending, disabled = false }: { action: () => Promise<{ error?: string; ok?: boolean; count?: number }>; label: string; pending: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="grid gap-2 justify-items-start">
      <button
        className="btn btn-primary btn-lg"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          const result = await action();
          if (result.error) setErr(result.error);
          else if (result.count != null) router.push(`/where-did-the-50-dollars-go?verified=${result.count}`);
          else router.refresh();
          setBusy(false);
        }}
      >
        {busy ? pending : label}
      </button>
      {err && <p className="text-[14px]" style={{ color: "var(--seal)" }}>{err}</p>}
    </div>
  );
}

export function ResetButton() {
  const { pending } = useFormStatus();
  return <button className="btn" disabled={pending}>{pending ? "Resetting…" : "Reset demo"}</button>;
}

export type DemoRow = { id: string; line: string; client: string; outcome: string; triggers: { code: string; reason: string }[]; note: string };

export function ReprocessFour({ rows, ids, action }: { rows: DemoRow[]; ids: string[]; action: (id: string) => Promise<{ error?: string }> }) {
  const [local, setLocal] = useState(rows);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="grid gap-4">
      <BillTable rows={local} />
      <div className="grid gap-2 justify-items-start">
        <button
          className="btn btn-primary btn-lg"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            for (const id of ids) {
              const result = await action(id);
              if (result.error) { setErr(result.error); setBusy(false); return; }
              setLocal((ls) => ls.map((r) => r.id === id ? { ...r, outcome: "READY", triggers: [], note: "" } : r));
              await new Promise((r) => setTimeout(r, 400));
            }
            setBusy(false);
            router.refresh();
          }}
        >
          {busy ? "Reprocessing…" : "Reprocess 4"}
        </button>
        {err && <p className="text-[14px]" style={{ color: "var(--seal)" }}>{err}</p>}
      </div>
    </div>
  );
}

export function BillTable({ rows }: { rows: DemoRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-[14px]" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr className="faint">{["Line", "Client", "Amount", "Outcome", "Why"].map((h) => <th key={h} className="py-2 pr-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td className="py-3 pr-3">{r.line}</td>
              <td className="py-3 pr-3">{r.client}</td>
              <td className="py-3 pr-3 tabular">$30.00</td>
              <td className="py-3 pr-3"><span className={`chip ${r.outcome === "READY" || r.outcome === "APPROVED" || r.outcome === "RELEASED" ? "chip-ok" : "chip-flag"}`}>{r.outcome}</span></td>
              <td className="py-3">{r.note || r.triggers.map((t) => t.reason).join(" ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
