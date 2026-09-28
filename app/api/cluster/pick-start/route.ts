import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { B2CCluster } from "@/lib/b2c-cluster";

const CLUSTER_TTL = 7 * 24 * 60 * 60; // 7 days — same as close.ts

/**
 * POST /api/cluster/pick-start?id=<clusterId>
 * Idempotent: records the moment picking actually began (first successful
 * location scan), as opposed to `createdAt` (when the cluster was built,
 * which may sit idle before a picker opens it). Only writes once — repeat
 * calls for the same cluster are no-ops that just return the existing value.
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const raw = await redis.get(`wms:b2ccluster:${id}`);
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cluster = (typeof raw === "string" ? JSON.parse(raw) : raw) as B2CCluster;

  if (cluster.pickStartedAt) {
    return NextResponse.json({ ok: true, pickStartedAt: cluster.pickStartedAt, alreadySet: true });
  }

  const pickStartedAt = new Date().toISOString();
  const updated: B2CCluster = { ...cluster, pickStartedAt };
  await redis.set(`wms:b2ccluster:${id}`, updated, { ex: CLUSTER_TTL });

  return NextResponse.json({ ok: true, pickStartedAt, alreadySet: false });
}
