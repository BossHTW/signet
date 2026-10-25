import fs from "node:fs";
import path from "node:path";
import { currentMode } from "@/lib/adapters/types";
import { memoryStats } from "@/lib/adapters/memory";

type Item = { name: string; detail: string; live: boolean; note?: string; title?: string };

function nessieAccount(): boolean {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/nessie.json"), "utf8")) as { accountId?: string };
    return Boolean(j.accountId);
  } catch {
    return false;
  }
}

function publicCacheCount(): number {
  try {
    return fs.readdirSync(path.join(process.cwd(), "data/cache/public")).length;
  } catch {
    return 0;
  }
}

export async function IntegrationStrip() {
  const mode = currentMode();
  const live = mode === "LIVE";
  const moss = memoryStats.lastQuerySource === "MOSS";
  const crsLive = Boolean(process.env.CRS_API_USERNAME && process.env.CRS_API_PASSWORD);
  const items: Item[] = [
    {
      name: "Claude",
      detail: "Haiku reads · Sonnet writes",
      live: live && Boolean(process.env.ANTHROPIC_API_KEY),
      note: "document parser",
    },
    {
      name: "Capital One Nessie",
      detail: "bank feed + release",
      live: nessieAccount(),
    },
    {
      name: "Bright Data",
      detail: "public records",
      live: Boolean(process.env.BRIGHTDATA_API_TOKEN),
      note: `${publicCacheCount()} cached`,
    },
    {
      name: "Moss",
      detail: "semantic memory",
      live: moss,
      note: memoryStats.lastQuerySource,
      title: memoryStats.lastQuerySource === "LOCAL-FALLBACK" ? memoryStats.lastError : undefined,
    },
    {
      name: "CRS",
      detail: "vendor identity (FraudFinder)",
      live: crsLive,
      note: crsLive ? "live" : "test identities",
    },
  ];
  return (
    <section className="grid gap-2">
      <div className="kicker">Sponsor APIs &amp; engines</div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {items.map((it) => (
          <li key={it.name} className="card p-3 flex items-start gap-2" title={it.title}>
            <span className="chip chip-grey mt-0.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: it.live ? "var(--ok)" : "var(--ink-3)" }} aria-label={it.live ? "live" : "mock"} />
              {it.live ? "Live" : it.name === "CRS" ? "test identities" : "Fallback"}
            </span>
            <div className="min-w-0">
              <div className="font-medium text-[14px]">{it.name}</div>
              <div className="text-[12px] muted">{it.detail}{it.note ? " · " : ""}{it.note ? <span title={it.title} style={it.note === "LOCAL-FALLBACK" ? { color: "var(--ink-3)" } : undefined}>{it.note}</span> : null}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
