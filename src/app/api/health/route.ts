import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { currentMode } from "@/lib/adapters";
export const dynamic = "force-dynamic";
export async function GET() {
  const rows = db.all(sql`select status, count(*) as c from requests group by status`) as { status: string; c: number }[];
  return NextResponse.json({ ok: true, mode: currentMode(), requests: Object.fromEntries(rows.map((r) => [r.status, r.c])), at: new Date().toISOString() });
}
