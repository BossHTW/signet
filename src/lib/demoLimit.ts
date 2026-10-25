// Public demo guard. One IP gets 20 live sponsor calls per 10 minutes.
import { headers } from "next/headers";

const WINDOW_MS = 10 * 60_000;
const MAX = 20;
const hits = new Map<string, number[]>();

export const DEMO_BUSY = "The demo is busy, try again in a minute";

export async function chargeDemoLive() {
  if (process.env.DEMO_PUBLIC !== "1") return;
  let ip = "unknown";
  try {
    const h = await headers();
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  } catch {
    return; // scripts and builds have no request
  }
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX) throw new Error(DEMO_BUSY);
  recent.push(now);
  hits.set(ip, recent);
}
