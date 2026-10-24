import type { Trigger } from "@/db/types";
export function TriggerChip({ t, withReason = false }: { t: Trigger; withReason?: boolean }) {
  const hard = t.code === "POL-HARD" || t.code === "VENDOR-FLAG" || t.code === "DUP-HIT";
  if (!withReason) return <span className={`chip ${hard ? "chip-hard" : "chip-flag"}`} title={t.reason}>{t.code}</span>;
  return (
    <div className="flex items-start gap-3 py-2" style={{ borderBottom: "1px solid var(--stone)" }}>
      <span className={`chip ${hard ? "chip-hard" : "chip-flag"} shrink-0 mt-0.5`}>{t.code}</span>
      <span className="text-sm">{t.reason}</span>
    </div>
  );
}
