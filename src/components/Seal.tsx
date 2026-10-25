import type { Seal as SealT } from "@/db/types";

export function Seal({ seal, outcome, status, size = 96 }: { seal: SealT; outcome: string; status?: string; size?: number }) {
  const human = seal.kind === "HUMAN";
  const top = human ? (status === "RELEASED" ? "Released" : "Certified") : "Verified";
  const mid = human ? (outcome === "DENIED" ? "DENIED" : status === "RELEASED" ? "PAID" : "APPROVED") : outcome === "READY" ? "READY" : "ASK";
  const label = `${top} ${mid}. ${human ? "A named person signed." : "The system verified."} ${seal.hash.slice(0, 8)}`;
  return (
    <div
      role="img"
      aria-label={label}
      title={`${seal.kind} seal · ${seal.by} · ${seal.at} · ${seal.hash}`}
      className={`seal ${human ? "seal-human" : "seal-system"}`}
      style={{ width: size, height: size }}
    >
      <div>
        <div style={{ fontSize: size * 0.12 }}>{top}</div>
        <div style={{ fontSize: size * 0.15 }}>{mid}</div>
        <div className="mono" style={{ fontSize: size * 0.085, letterSpacing: 0, textTransform: "none", fontWeight: 400 }}>{seal.hash.slice(0, 8)}</div>
      </div>
    </div>
  );
}
