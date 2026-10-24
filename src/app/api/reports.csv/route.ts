import { reportsCsv } from "@/lib/reports";
export async function GET() { return new Response(reportsCsv(), { headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=signet-compliance.csv" } }); }
