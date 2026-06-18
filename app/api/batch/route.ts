import { NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { Batch } from "@/lib/batch";

export async function GET() {
  const keys = await redis.keys("wms:batch:*");
  if (keys.length === 0) return NextResponse.json([]);
  const values = await Promise.all(keys.map((k) => redis.get(k)));
  const batches = (values
    .map((v) => {
      if (!v) return null;
      if (typeof v === "string") { try { return JSON.parse(v) as Batch; } catch { return null; } }
      return v as Batch;
    })
    .filter(Boolean) as Batch[])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return NextResponse.json(batches);
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  await redis.del(`wms:batch:${id}`);
  return NextResponse.json({ ok: true });
}
