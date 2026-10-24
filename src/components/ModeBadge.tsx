import { currentMode } from "@/lib/adapters/types";
export function ModeBadge() {
  const m = currentMode();
  const label = m === "LIVE" ? "LIVE · Claude · Nessie · CRS" : m === "OFFLINE" ? "OFFLINE · cached" : "MOCK · local";
  return <span className="chip" style={{ background: m === "LIVE" ? "var(--yellow)" : "var(--stone)", color: "var(--black)" }}>{label}</span>;
}
