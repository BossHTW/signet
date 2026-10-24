import type { Seal as SealT } from "@/db/types";
export function Seal({ seal, outcome, size = 96 }: { seal: SealT; outcome: string; size?: number }) {
  const human = seal.kind === "HUMAN";
  return (
    <div title={`${seal.kind} seal · ${seal.at} · ${seal.hash}`} className={`seal ${human ? "seal-human" : "seal-system"}`} style={{ width: size, height: size }}>
      <div>
        <div style={{ fontSize: size * 0.12 }}>{human ? "Sealed" : "System"}</div>
        <div style={{ fontSize: size * 0.15 }}>{outcome}</div>
        <div className="mono" style={{ fontSize: size * 0.085, letterSpacing: 0, textTransform: "none", fontWeight: 400 }}>{seal.hash.slice(0, 8)}</div>
      </div>
    </div>
  );
}
