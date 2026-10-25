import { currentMode } from "@/lib/adapters/types";

const LIVE_SPONSORS = ["Claude", "Nessie", "Bright Data", "Moss", "CRS"] as const;

export function ModeBadge() {
  const m = currentMode();
  const label = m === "LIVE" ? "Live" : m === "OFFLINE" ? "Offline · cached" : "Demo data";
  const title = m === "LIVE" ? "Live: Claude, Capital One Nessie, Bright Data, Moss and CRS are called for real" : m === "OFFLINE" ? "Offline: every response comes from the committed cache" : "Mock: local adapters, no network";
  return (
    <span className="flex items-center gap-1 shrink-0">
      <span className="chip chip-grey" title={title}>
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: m === "LIVE" ? "var(--ok)" : "var(--ink-3)" }} aria-hidden />
        {label}
      </span>
      {m === "LIVE" && LIVE_SPONSORS.map((name) => (
        <span key={name} className="chip chip-grey" style={{ fontSize: "11px", padding: "2px 6px" }}>{name}</span>
      ))}
    </span>
  );
}
