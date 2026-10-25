import type { Trigger } from "@/db/types";
import { TRIGGER } from "@/lib/labels";

export function TriggerChip({ t, withReason = false }: { t: Trigger; withReason?: boolean }) {
  const meta = TRIGGER[t.code];
  if (!withReason) {
    return (
      <span className="chip chip-flag" title={`${t.code} — ${t.reason}`}>
        {meta?.title ?? t.code}
        <span className="code">{t.code}</span>
      </span>
    );
  }
  return (
    <div className="py-2 grid gap-1" style={{ borderBottom: "1px solid var(--line)" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="chip chip-flag">{meta?.title ?? t.code}</span>
        <span className="mono text-[11px] faint">{t.code}</span>
      </div>
      <div className="text-[15px]">{t.reason}</div>
      {meta && <div className="text-[13px] muted">Look at: {meta.look}</div>}
    </div>
  );
}
