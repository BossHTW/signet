import { NextResponse } from "next/server";
import { defend } from "@/lib/pipeline";
export async function POST(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try { return NextResponse.json({ text: await defend(id) }); } catch (e) { return NextResponse.json({ text: `Unavailable: ${(e as Error).message}` }, { status: 500 }); }
}
