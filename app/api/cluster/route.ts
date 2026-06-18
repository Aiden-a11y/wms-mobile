import { NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { B2CCluster } from "@/lib/b2c-cluster";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (id) {
    const raw = await redis.get(`wms:b2ccluster:${id}`);
    if (!raw) return NextResponse.json(null, { status: 404 });
    const cluster = typeof raw === "string" ? JSON.parse(raw) : raw;
    return NextResponse.json(cluster);
  }

  const keys = await redis.keys("wms:b2ccluster:*");
  if (keys.length === 0) return NextResponse.json([]);
  const values = await Promise.all(keys.map((k) => redis.get(k)));
  const clusters = (values
    .map((v) => {
      if (!v) return null;
      return (typeof v === "string" ? JSON.parse(v) : v) as B2CCluster;
    })
    .filter(Boolean) as B2CCluster[])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return NextResponse.json(clusters);
}
