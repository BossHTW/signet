"use client";

export function NessieInspect({ raw, label = "Inspect Nessie response" }: { raw: unknown; label?: string }) {
  if (raw == null) return null;
  return (
    <details className="grid gap-1">
      <summary className="btn" style={{ minHeight: 32, fontSize: "13px", justifySelf: "start", cursor: "pointer" }}>{label}</summary>
      <pre className="mono text-[11px] p-3 rounded-lg overflow-auto" style={{ maxHeight: 240, background: "var(--paper)", border: "1px solid var(--line)" }}>
        {JSON.stringify(raw, null, 2)}
      </pre>
    </details>
  );
}
