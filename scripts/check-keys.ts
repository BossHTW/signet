// Verifies each external key with one tiny call. Run: npm run check
import fs from "node:fs";
import { loadEnv } from "./env";
async function main() {
  loadEnv();
  const row = (k: string, ok: boolean, note: string) => console.log(`${ok ? "✓" : "✗"} ${k.padEnd(12)} ${note}`);
  // Anthropic
  try { const { default: Anthropic } = await import("@anthropic-ai/sdk"); const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); const m = await c.models.list({ limit: 1 }); row("Anthropic", true, `ok (${m.data[0]?.id})`); } catch (e) { row("Anthropic", false, (e as Error).message.slice(0, 80)); }
  // Bright Data
  try { const r = await fetch("https://api.brightdata.com/zone/get_active_zones", { headers: { Authorization: `Bearer ${process.env.BRIGHTDATA_API_TOKEN ?? ""}` } }); const z = (await r.json()) as { name: string; type: string }[]; row("Bright Data", r.ok, r.ok ? `zones: ${z.map((x) => `${x.name}(${x.type})`).join(", ") || "none — add a Web Unlocker zone"}` : `HTTP ${r.status}`); } catch (e) { row("Bright Data", false, (e as Error).message.slice(0, 80)); }
  // Moss
  try { const { MossClient } = await import("@moss-js/moss"); const c = new MossClient(process.env.MOSS_PROJECT_ID ?? "", process.env.MOSS_PROJECT_KEY ?? ""); const idx = await c.listIndexes(); row("Moss", true, `ok · ${idx.length} index(es)`); } catch (e) { row("Moss", false, (e as Error).message.slice(0, 80)); }
  // Nessie
  try { const r = await fetch(`${process.env.NESSIE_BASE_URL ?? "https://api.nessieisreal.com"}/customers?key=${process.env.NESSIE_API_KEY ?? ""}`); row("Nessie", r.ok, r.ok ? `ok · ${((await r.json()) as unknown[]).length} customer(s)` : `HTTP ${r.status}`); } catch (e) { row("Nessie", false, (e as Error).message.slice(0, 80)); }
  // CRS
  try { const base = (process.env.CRS_BASE_URL ?? "https://api-sandbox.stitchcredit.com/api").replace(/\/+$/, "");
    if (!process.env.CRS_API_USERNAME || !process.env.CRS_API_PASSWORD) { row("CRS", false, "not configured (mock) - set CRS_API_USERNAME/PASSWORD"); }
    else { const r = await fetch(`${base}/users/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: process.env.CRS_API_USERNAME, password: process.env.CRS_API_PASSWORD }) }); const j = await r.json().catch(() => ({})); const t = (j as { data?: { token?: string }; token?: string })?.data?.token ?? (j as { token?: string }).token; row("CRS", r.ok && Boolean(t), r.ok ? (t ? "login ok (StitchCredit sandbox)" : "login ok, no token") : `HTTP ${r.status}`); }
  } catch (e) { row("CRS", false, (e as Error).message.slice(0, 80)); }
}
main();
