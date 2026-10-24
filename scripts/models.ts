// Lists the model IDs your API key can use. Run: npm run models
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";

async function main() {
  for (const line of fs.existsSync(".env.local") ? fs.readFileSync(".env.local", "utf8").split("\n") : []) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
  const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const page = await c.models.list({ limit: 50 });
  for (const m of page.data) console.log(m.id.padEnd(36), m.display_name);
  console.log("\nSet CLAUDE_HAIKU_MODEL / CLAUDE_SONNET_MODEL in .env.local to any ID above.");
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
