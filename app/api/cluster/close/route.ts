import { NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { B2CCluster } from "@/lib/b2c-cluster";

const CLUSTER_TTL = 7 * 24 * 60 * 60; // 7 days

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const raw = await redis.get(`wms:b2ccluster:${id}`);
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 });

  const cluster = (typeof raw === "string" ? JSON.parse(raw) : raw) as B2CCluster;
  const updated: B2CCluster = {
    ...cluster,
    status: "completed",
    completedAt: new Date().toISOString(),
  };
  await redis.set(`wms:b2ccluster:${id}`, updated, { ex: CLUSTER_TTL });
  return NextResponse.json({ ok: true });
}
