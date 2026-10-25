// Replace the open database with the committed demo snapshot. One reset per minute, process-wide.
import path from "node:path";
import { db } from "@/db/client";
import { ensureMemory } from "@/lib/pipeline";

const WAIT_MS = 60_000;
const g = globalThis as { __signetResetAt?: number; __signetResetting?: boolean };

function quote(name: string) {
  return `"${name.replace(/"/g, "\"\"")}"`;
}

export async function resetDemo(): Promise<{ skipped: true } | { skipped: false }> {
  const now = Date.now();
  if (g.__signetResetting || (g.__signetResetAt && now - g.__signetResetAt < WAIT_MS)) return { skipped: true };
  g.__signetResetting = true;
  const sqlite = db.$client;
  const snap = path.join(process.cwd(), "data", "demo-snapshot.db").replace(/'/g, "''");
  try {
    sqlite.pragma("foreign_keys = OFF");
    sqlite.exec(`ATTACH DATABASE '${snap}' AS snap`);
    const tables = sqlite.prepare("SELECT name FROM snap.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
    const names = tables.map((t) => t.name);
    sqlite.transaction(() => {
      for (const name of [...names, "sqlite_sequence"]) sqlite.exec(`DELETE FROM main.${quote(name)}`);
      for (const name of names) sqlite.exec(`INSERT INTO main.${quote(name)} SELECT * FROM snap.${quote(name)}`);
      sqlite.exec("DELETE FROM main.sqlite_sequence");
      sqlite.exec("INSERT INTO main.sqlite_sequence SELECT * FROM snap.sqlite_sequence");
    })();
    sqlite.exec("DETACH DATABASE snap");
    sqlite.pragma("foreign_keys = ON");
    await ensureMemory(true);
    g.__signetResetAt = Date.now();
    return { skipped: false };
  } catch (e) {
    try { sqlite.exec("DETACH DATABASE snap"); } catch { /* not attached */ }
    sqlite.pragma("foreign_keys = ON");
    throw e;
  } finally {
    g.__signetResetting = false;
  }
}
