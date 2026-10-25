// Load .env.local into process.env for CLI scripts (Next does this itself for the app). Tolerates CRLF, quotes, spaces, `export`.
import fs from "node:fs";
import dns from "node:dns";

// Venue Wi-Fi often advertises IPv6 but drops it; Node's fetch then hangs with UND_ERR_CONNECT_TIMEOUT while curl works.
dns.setDefaultResultOrder("ipv4first");
export function loadEnv(file = ".env.local") {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const m = raw.replace(/\r$/, "").match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
