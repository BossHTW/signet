// Public web data via Bright Data (Web Unlocker + Google JSON). Every result is cached with fetched_at so the
// demo replays offline and no judge waits on a 2–40 s fetch. Public, logged-out sources only.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { currentMode } from "./types";
import { chargeDemoLive, DEMO_BUSY } from "@/lib/demoLimit";

const API = "https://api.brightdata.com";
const CACHE_DIR = path.join(process.cwd(), "data", "cache", "public");

export type PublicRecord = {
  vendorQuery: string;
  sfBusiness: { found: boolean; count: number; dbaNames: string[]; ownerNames: string[]; firstStart: string | null; active: boolean | null; source: string } | null;
  web: { found: boolean; results: { title: string; link: string; displayLink: string }[]; source: string } | null;
  fetchedAt: string;
  source: "BRIGHTDATA" | "PLAIN" | "MOCK" | "CACHE";
  errors: string[];
};

export type RentBenchmark = { area: string; year: number; fmrCents: Record<"0br" | "1br" | "2br" | "3br" | "4br", number>; fetchedAt: string; source: string; sourceUrl: string };

export const publicStats = { calls: 0, cacheHits: 0, failures: 0, lastError: "" };

const token = () => process.env.BRIGHTDATA_API_TOKEN ?? process.env.BRIGHTDATA_API_KEY ?? "";
const key = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
function cget<T>(k: string): T | null { try { return JSON.parse(fs.readFileSync(path.join(CACHE_DIR, k + ".json"), "utf8")) as T; } catch { return null; } }
function cset(k: string, v: unknown) { fs.mkdirSync(CACHE_DIR, { recursive: true }); fs.writeFileSync(path.join(CACHE_DIR, k + ".json"), JSON.stringify(v, null, 2)); }

let zoneCache: string | null = null;
async function zone(): Promise<string> {
  if (process.env.BRIGHTDATA_ZONE) return process.env.BRIGHTDATA_ZONE;
  if (zoneCache) return zoneCache;
  const r = await fetch(`${API}/zone/get_active_zones`, { headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`zone lookup HTTP ${r.status}`);
  const zones = (await r.json()) as { name: string; type: string }[];
  const z = zones.find((x) => x.type === "unblocker") ?? zones.find((x) => x.type === "serp");
  if (!z) throw new Error("no Web Unlocker zone on this account");
  return (zoneCache = z.name);
}

/** Web Unlocker: fetch any public page (raw body). Up to 3 attempts per the hackpack guidance. */
export async function unlock(url: string, opts: { timeoutMs?: number } = {}): Promise<string> {
  await chargeDemoLive();
  const z = await zone();
  let why = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(`${API}/request`, {
      method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone: z, url, format: "raw", country: "us" }), signal: AbortSignal.timeout(opts.timeoutMs ?? 60000),
    });
    publicStats.calls++;
    const text = await r.text();
    if (r.status === 200 && text.length > 50 && !/prove your humanity/i.test(text.slice(0, 5000))) return text;
    if (r.status === 401 || r.status === 403) throw new Error(`Bright Data HTTP ${r.status}: check BRIGHTDATA_API_TOKEN / zone`);
    why = `HTTP ${r.status} ${r.headers.get("x-brd-error-code") ?? ""} len=${text.length}`.trim();
    await new Promise((res) => setTimeout(res, 2500 * attempt));
  }
  throw new Error(`unlock failed after 3 attempts: ${why}`);
}

const GENERIC = new Set(["llc", "inc", "co", "corp", "company", "services", "the", "of", "and", "sf", "san", "francisco", "ca"]);

/** Distinctive tokens of the vendor name must actually appear in the hit. Generic pages do not count. */
const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

export function nameMatches(vendor: string, text: string): boolean {
  const tokens = words(vendor).filter((t) => !GENERIC.has(t));
  if (!tokens.length) return false;
  const hay = new Set(words(text));
  const hit = tokens.filter((t) => hay.has(t)).length;
  return tokens.length > 3 ? hit >= 2 : hit === tokens.length;
}

const strip = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
type WebHit = { title: string; link: string; displayLink: string };
const host = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };

/** Web presence through Bright Data. Three parsers, first that works wins:
 *  1) Google with brd_json=1 (works on SERP-enabled zones), 2) raw Google HTML, 3) DuckDuckGo HTML (no JS, easy to parse). */
async function webSearch(q: string): Promise<{ results: WebHit[]; source: string }> {
  const errors: string[] = [];
  try {
    const body = await unlock(`https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us&brd_json=1`, { timeoutMs: 40000 });
    if (body.trim().startsWith("{")) {
      const j = JSON.parse(body) as { organic?: { link: string; title: string; display_link?: string }[] };
      return { results: (j.organic ?? []).slice(0, 5).map((o) => ({ title: o.title, link: o.link, displayLink: o.display_link ?? host(o.link) })), source: "Google (JSON) via Bright Data" };
    }
    // Not JSON: this zone returns the page itself. Parse organic results from the HTML.
    if (/did not match any documents/i.test(body)) return { results: [], source: "Google via Bright Data" };
    const hits: WebHit[] = [];
    for (const m of body.matchAll(/<a [^>]*href="(https?:\/\/(?!www\.google\.|accounts\.google|support\.google|policies\.google|maps\.google)[^"]+)"[^>]*>(?:(?!<\/a>)[\s\S])*?<h3[^>]*>([\s\S]*?)<\/h3>/g)) {
      if (hits.length >= 5) break;
      hits.push({ title: strip(m[2]).slice(0, 120), link: m[1], displayLink: host(m[1]) });
    }
    if (hits.length) return { results: hits, source: "Google via Bright Data" };
    errors.push(`google: no organic results parsed (len=${body.length})`);
  } catch (e) { errors.push(`google: ${(e as Error).message.slice(0, 80)}`); }
  try {
    const body = await unlock(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { timeoutMs: 40000 });
    const hits: WebHit[] = [];
    for (const m of body.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      if (hits.length >= 5) break;
      let link = m[1];
      const uddg = link.match(/[?&]uddg=([^&]+)/); if (uddg) link = decodeURIComponent(uddg[1]);
      if (!/^https?:/.test(link)) link = "https:" + link;
      hits.push({ title: strip(m[2]).slice(0, 120), link, displayLink: host(link) });
    }
    if (hits.length || /no results/i.test(body)) return { results: hits, source: "DuckDuckGo via Bright Data" };
    errors.push(`ddg: no results parsed (len=${body.length})`);
  } catch (e) { errors.push(`ddg: ${(e as Error).message.slice(0, 80)}`); }
  throw new Error(errors.join(" | "));
}

/** SF Registered Business Locations (DataSF, Socrata). Public JSON API, so plain fetch first (fast); Unlocker if that is blocked. */
async function sfBusiness(name: string): Promise<NonNullable<PublicRecord["sfBusiness"]>> {
  const q = name.replace(/[^A-Za-z0-9 &'-]/g, " ").trim();
  // data.sfgov.org now 301s to data.sf.gov; hit the current host so a redirect page is never parsed as JSON.
  const url = `https://data.sf.gov/resource/g8m3-pdis.json?$q=${encodeURIComponent(q)}&$limit=25`;
  let text = "";
  let source = "data.sf.gov";
  let plainError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      text = await r.text();
      publicStats.calls++;
      plainError = "";
      break;
    } catch (e) {
      plainError = (e as Error).message;
      if (attempt < 3) await new Promise((res) => setTimeout(res, 1500 * attempt));
    }
  }
  if (plainError) { source = "data.sf.gov via Bright Data"; publicStats.lastError = plainError; text = await unlock(url, { timeoutMs: 45000 }); }
  type Row = { dba_name?: string; ownership_name?: string; dba_start_date?: string; location_start_date?: string; dba_end_date?: string; administratively_closed?: string };
  const rows = JSON.parse(text) as Row[];
  const dba = [...new Set(rows.map((r) => r.dba_name).filter(Boolean) as string[])].slice(0, 8);
  const owners = [...new Set(rows.map((r) => r.ownership_name).filter(Boolean) as string[])].slice(0, 5);
  const starts = rows.map((r) => r.dba_start_date ?? r.location_start_date).filter(Boolean).sort() as string[];
  const active = rows.length ? rows.some((r) => !r.dba_end_date && !r.administratively_closed) : null;
  return { found: rows.length > 0, count: rows.length, dbaNames: dba, ownerNames: owners, firstStart: starts[0]?.slice(0, 10) ?? null, active, source };
}

/** Public record for a vendor: SF business registry + web presence. Cached by normalized name. `force` skips the cache read and writes a fresh result. */
export async function vendorPublicRecord(vendorName: string, opts: { allowNetwork?: boolean; refetchPartial?: boolean; force?: boolean } = {}): Promise<PublicRecord> {
  const k = key(["vendor", vendorName.toLowerCase().replace(/\s+/g, " ").trim()]);
  const prev = cget<PublicRecord>(k);
  const hit = opts.force ? null : prev;
  const mode = currentMode();
  // A record fetched without a working zone has errors and no web half; the prefetch script asks to redo those.
  const partial = Boolean(hit && hit.errors?.length && !hit.web);
  if (hit && !(partial && opts.refetchPartial && mode === "LIVE")) { publicStats.cacheHits++; return { ...hit, source: "CACHE" }; }
  // Only LIVE goes to the web, unless this is an explicit re-check. MOCK and OFFLINE use what is cached, else a labeled mock.
  if (!opts.force && (mode !== "LIVE" || opts.allowNetwork === false)) return mock(vendorName, `${mode}: no cached public record`);
  const rec: PublicRecord = { vendorQuery: vendorName, sfBusiness: null, web: null, fetchedAt: new Date().toISOString(), source: token() ? "BRIGHTDATA" : "PLAIN", errors: [] };
  const [sf, web] = await Promise.allSettled([
    sfBusiness(vendorName),
    token() ? webSearch(`"${vendorName}" San Francisco`) : Promise.reject(new Error("no BRIGHTDATA_API_TOKEN")),
  ]);
  if ((sf.status === "rejected" && (sf.reason as Error)?.message === DEMO_BUSY) || (web.status === "rejected" && (web.reason as Error)?.message === DEMO_BUSY)) throw new Error(DEMO_BUSY);
  if (sf.status === "fulfilled") rec.sfBusiness = sf.value;
  else {
    rec.errors.push(`sf: ${(sf.reason as Error).message.slice(0, 120)}`);
    if (prev?.sfBusiness) rec.sfBusiness = prev.sfBusiness; // a failed re-check must not erase a registry hit we already have
  }
  if (web.status === "fulfilled") {
    const results = web.value.results.filter((r) => nameMatches(vendorName, `${r.title} ${r.displayLink}`));
    rec.web = { found: results.length > 0, results, source: web.value.source };
  } else {
    rec.errors.push(`web: ${(web.reason as Error).message.slice(0, 160)}`);
    if (prev?.web) rec.web = prev.web;
  }
  if (rec.errors.length) { publicStats.failures++; publicStats.lastError = rec.errors.join(" | "); }
  cset(k, rec); // cache failures too (with their errors); the prefetch script re-fetches partial records
  return rec;
}

/** HUD Fair Market Rent for the San Francisco HMFA. Cached; a conservative built-in fallback is labeled as such. */
export async function rentBenchmark(): Promise<RentBenchmark> {
  const k = key(["fmr", "san-francisco", 2026]);
  const hit = cget<RentBenchmark>(k);
  if (hit) return hit;
  const fallback: RentBenchmark = { area: "San Francisco, CA HUD Metro FMR Area", year: 2026, fmrCents: { "0br": 2_300_00, "1br": 2_850_00, "2br": 3_500_00, "3br": 4_500_00, "4br": 5_100_00 }, fetchedAt: new Date().toISOString(), source: "built-in fallback (approximate FY2025 HUD FMR; not fetched)", sourceUrl: "https://www.huduser.gov/portal/datasets/fmr.html" };
  if (currentMode() !== "LIVE" || !token()) return fallback;
  try {
    // HUD's FMR lookup page for the SF metro; parse the Final FMR row. If the markup changes, keep the fallback and say so.
    const url = "https://www.huduser.gov/portal/datasets/fmr/fmrs/FY2026_code/2026summary.odn?cbsasub=METRO41860MM7360&year=2026";
    let html: string;
    try { const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "user-agent": "Mozilla/5.0 (signet; public FMR lookup)" } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); html = await r.text(); publicStats.calls++; }
    catch { html = await unlock(url, { timeoutMs: 60000 }); }
    const nums = [...html.replace(/<[^>]+>/g, " ").matchAll(/\$\s?([\d,]{4,6})/g)].map((m) => Number(m[1].replace(/,/g, "")) * 100);
    const row = nums.filter((n) => n >= 1_000_00 && n <= 9_000_00).slice(0, 5);
    if (row.length === 5) {
      const rec: RentBenchmark = { area: "San Francisco, CA HUD Metro FMR Area", year: 2026, fmrCents: { "0br": row[0], "1br": row[1], "2br": row[2], "3br": row[3], "4br": row[4] }, fetchedAt: new Date().toISOString(), source: "HUD FMR via Bright Data", sourceUrl: url };
      cset(k, rec); return rec;
    }
    publicStats.lastError = "FMR page parsed but no 5-value row found";
  } catch (e) { publicStats.failures++; publicStats.lastError = (e as Error).message; }
  return { ...fallback, source: `${fallback.source}; last error: ${publicStats.lastError.slice(0, 100)}` };
}

function mock(vendorName: string, why: string): PublicRecord {
  return { vendorQuery: vendorName, sfBusiness: null, web: null, fetchedAt: new Date().toISOString(), source: "MOCK", errors: [why] };
}

export function publicCheckLabel(fetchedAt: string | undefined, cookie: string | undefined, vendor: string): { text: string; stale: boolean } {
  const when = fetchedAt ? fetchedAt.slice(0, 16).replace("T", " ") : "—";
  let mark: { vendor?: string; stale?: boolean } | null = null;
  try { mark = cookie ? JSON.parse(cookie) as { vendor?: string; stale?: boolean } : null; } catch { mark = null; }
  const same = mark?.vendor === vendor.toLowerCase().replace(/\s+/g, " ").trim();
  if (same && !mark?.stale) return { text: "Fetched live just now", stale: false };
  return { text: `Cached ${when}`, stale: Boolean(same && mark?.stale) };
}
