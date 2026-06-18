import { NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { Batch } from "@/lib/batch";

const DONE_TTL = 60 * 24 * 60 * 60; // 60 days

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const raw = await redis.get(`wms:batch:${id}`);
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 });

  const batch = (typeof raw === "string" ? JSON.parse(raw) : raw) as Batch;
  const completed: Batch = {
    ...batch,
    status: "completed",
    completedAt: new Date().toISOString(),
  };

  await redis.set(`wms:batchdone:${id}`, completed, { ex: DONE_TTL });
  await redis.del(`wms:batch:${id}`);

  return NextResponse.json({ ok: true });
}
