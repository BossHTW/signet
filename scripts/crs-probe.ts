// Find where CRS puts the token. Run: npm run crs:probe  (prints key paths + lengths, never values)
import { loadEnv } from "./env";
async function main() {
  loadEnv();
  const base = (process.env.CRS_BASE_URL ?? "https://api-sandbox.stitchcredit.com/api").replace(/\/+$/, "");
  const username = process.env.CRS_API_USERNAME, password = process.env.CRS_API_PASSWORD;
  if (!username || !password) { console.error("Set CRS_API_USERNAME and CRS_API_PASSWORD in .env.local"); process.exit(1); }
  const r = await fetch(`${base}/users/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
  console.log("login HTTP", r.status);
  // header-based token?
  for (const h of ["authorization", "x-auth-token", "token", "set-cookie"]) { const v = r.headers.get(h); if (v) console.log(`header ${h}: present (len ${v.length})`); }
  const text = await r.text();
  let j: unknown; try { j = JSON.parse(text); } catch { console.log("non-JSON body (first 200):", text.slice(0, 200)); return; }
  // walk and print every key path + a type/length hint; flag anything that looks like a token
  const seen: string[] = [];
  const walk = (o: unknown, path: string) => {
    if (o && typeof o === "object") { for (const [k, v] of Object.entries(o as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k); }
    else { const s = String(o); const tokenish = /token|jwt|access|bearer|auth/i.test(path) || (typeof o === "string" && s.length > 40 && /^[A-Za-z0-9._-]+$/.test(s)); seen.push(`${path} = <${typeof o}${typeof o === "string" ? `, len ${s.length}` : ""}>${tokenish ? "   <-- LOOKS LIKE A TOKEN" : ""}`); }
  };
  walk(j, "");
  console.log("response shape (paths only, no values):");
  for (const line of seen.slice(0, 80)) console.log("  " + line);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
