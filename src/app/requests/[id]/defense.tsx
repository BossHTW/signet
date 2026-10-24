"use client";
import { useState, useTransition } from "react";
export function DefenseButton({ requestId }: { requestId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2">
      <button className="btn" style={{ fontSize: ".85rem", padding: ".5rem 1rem" }} disabled={pending} onClick={() => start(async () => { const r = await fetch(`/api/requests/${requestId}/defend`, { method: "POST" }); setText((await r.json()).text); })}>
        {pending ? "Drafting from the record…" : text ? "Redraft explanation" : "Why? (explain from the record)"}
      </button>
      {text && <div className="text-sm p-3 rounded-lg" style={{ background: "var(--concrete)" }}><span className="chip chip-grey mr-2" style={{ fontSize: ".62rem" }}>agent explanation · drafted from the record</span>{text}</div>}
    </div>
  );
}
