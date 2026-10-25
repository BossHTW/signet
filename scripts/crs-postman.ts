// Extract request shapes from a downloaded CRS Postman collection WITHOUT leaking secrets.
// Run: npm run crs:postman -- /path/to/collection.json
// Prints method + URL + body for requests matching reverse/append/fraud/truvalidate/login; redacts password/token/secret values.
import fs from "node:fs";

const SCRUB = /("?(?:password|passwd|pwd|token|secret|apikey|api[_-]?key|authorization)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}&]+)/gi;
const redact = (s: string) => (s ?? "").replace(SCRUB, '$1"***"');
const MATCH = /reverse|append|fraud|truvalidate|tru-validate|id\s*search|login|phone/i;

function urlRaw(u: unknown): string {
  if (!u) return "";
  if (typeof u === "string") return u;
  const o = u as { raw?: string };
  return o.raw ?? "";
}
function walk(items: unknown[], trail: string[] = []) {
  for (const it of items ?? []) {
    const node = it as { name?: string; item?: unknown[]; request?: { method?: string; url?: unknown; body?: { raw?: string } } };
    const name = node.name ?? "(unnamed)";
    if (Array.isArray(node.item)) { walk(node.item, [...trail, name]); continue; }
    const req = node.request;
    if (!req) continue;
    if (!MATCH.test(name) && !MATCH.test(urlRaw(req.url))) continue;
    console.log("────────────────────────────────────────");
    console.log("NAME :", [...trail, name].join(" / "));
    console.log("METH :", req.method ?? "?");
    console.log("URL  :", redact(urlRaw(req.url)));
    const body = req.body?.raw;
    if (body) { console.log("BODY :"); console.log(redact(body)); }
  }
}
const path = process.argv[2];
if (!path) { console.error("usage: npm run crs:postman -- /path/to/collection.json"); process.exit(1); }
const col = JSON.parse(fs.readFileSync(path, "utf8")) as { item?: unknown[] };
console.log("Collection loaded. Matching requests (secrets redacted):\n");
walk(col.item ?? []);
