import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const d = db.select().from(schema.documents).where(eq(schema.documents.id, id)).get();
  if (!d?.imagePath || !fs.existsSync(d.imagePath)) return new Response("not found", { status: 404 });
  const type = d.imagePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
  return new Response(fs.readFileSync(d.imagePath), { headers: { "content-type": type } });
}
