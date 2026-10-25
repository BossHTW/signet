import { NextResponse } from "next/server";
import { explain } from "@/lib/pipeline";
export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try { return NextResponse.json(await explain(id)); } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}
