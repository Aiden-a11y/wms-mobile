import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { B2CCluster } from "@/lib/b2c-cluster";

const WMS_BASE = "https://us-wms-api.stload.com/api";
const CLUSTER_TTL = 7 * 24 * 60 * 60; // 7 days

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const raw = await redis.get(`wms:b2ccluster:${id}`);
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 });

  const cluster = (typeof raw === "string" ? JSON.parse(raw) : raw) as B2CCluster;

  // Mark completed in Redis
  const updated: B2CCluster = {
    ...cluster,
    status: "completed",
    completedAt: new Date().toISOString(),
  };
  await redis.set(`wms:b2ccluster:${id}`, updated, { ex: CLUSTER_TTL });

  // Change all order statuses to CA (Packing Request)
  const auth = req.headers.get("authorization");
  if (auth) {
    const grouped = new Map<string, string[]>();
    for (const bin of cluster.bins) {
      if (!grouped.has(bin.customerCode)) grouped.set(bin.customerCode, []);
      grouped.get(bin.customerCode)!.push(bin.orderCode);
    }
    await Promise.all(
      Array.from(grouped.entries()).map(([customerCode, orderCodes]) =>
        fetch(`${WMS_BASE}/shipping/status-change`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({
            warehouseCode: cluster.warehouseCode,
            customerCode,
            orderCodes,
            newStatus: "CA",
            completeDate: "",
            cancelComment: "",
          }),
        }).catch(() => {})
      )
    );
  }

  return NextResponse.json({ ok: true });
}
