// One-time cleanup. Run ON YOUR MAC (not from Claude's helper): npx tsx scripts/cleanup-tonight.ts
// 1) rejects the inverted "Mint Mobile is approved" escalate rule (uvIdWpmx69), as Finance, with an audit event
// 2) finishes req_PcT5YL, which has been stuck in PROCESSING (invisible in the UI) since the DB corruption
import { loadEnv } from "./env";
loadEnv();
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db/client";
import { rejectRule, processRequest } from "../src/lib/pipeline";

async function main() {
  const rule = db.select().from(schema.ruleProposals).where(eq(schema.ruleProposals.id, "uvIdWpmx69")).get();
  if (rule?.status === "PROPOSED") { rejectRule({ proposalId: rule.id, humanId: "finance.director" }); console.log("rejected rule uvIdWpmx69"); }
  else console.log("rule uvIdWpmx69:", rule?.status ?? "not found", "(nothing to do)");

  const req = db.select().from(schema.requests).where(eq(schema.requests.id, "req_PcT5YL")).get();
  if (req?.status === "PROCESSING") {
    const d = await processRequest(req.id, { reprocess: true });
    console.log("req_PcT5YL ->", d.outcome, d.triggers.map((t) => t.code).join(",") || "no triggers");
  } else console.log("req_PcT5YL:", req?.status ?? "not found", "(nothing to do)");
}
main().catch((e) => { console.error(e); process.exit(1); });
