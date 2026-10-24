// Disk cache for every model response, keyed by sha256 of the input. Committed to the repo → offline demo.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const DIR = path.join(process.cwd(), "data", "cache");

export function cacheKey(parts: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
export function cacheGet<T>(key: string): T | null {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, key + ".json"), "utf8")) as T; } catch { return null; }
}
export function cacheSet(key: string, value: unknown) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, key + ".json"), JSON.stringify(value, null, 2));
}

// in-process stats for the metrics panel
export const llmStats = { calls: 0, hits: 0, inputTokens: 0, outputTokens: 0, spendUsd: 0 };
