import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { B2CCluster } from "@/lib/b2c-cluster";

const WMS_BASE = "https://us-wms-api.stload.com/api";
const CLUSTER_TTL = 7 * 24 * 60 * 60; // 7 days

// Statuses that are at or beyond CA — sending CA would revert progress
const SKIP_CA_STATUSES = new Set(["DA", "FA", "AC", "LC", "EA"]);

// Fetch current WMS status for a single order code.
// Returns null if the status cannot be determined (caller treats as safe-to-CA).
async function fetchOrderStatus(
  warehouseCode: string,
  customerCode: string,
  orderCode: string,
  auth: string,
): Promise<string | null> {
  for (const ep of [
    `${WMS_BASE}/shipping/b2c/list`,
    `${WMS_BASE}/shipping/list`,
  ]) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({
          page: 1, limit: 50, pageSize: 50,
          warehouseCode, customerCode,
          shippingOrderCode: orderCode,
        }),
      });
      const j = await res.json().catch(() => null);
      if (!j) continue;
      const list: Record<string, unknown>[] =
        (j?.data as Record<string, unknown>)?.list as Record<string, unknown>[] ??
        (j?.data as Record<string, unknown>)?.items as Record<string, unknown>[] ??
        j?.data ?? j?.list ?? [];
      if (!Array.isArray(list)) continue;
      const order = list.find(
        (o) => String(o.shippingOrderCode ?? o.orderCode ?? "") === orderCode,
      );
      if (order) return String(order.status ?? order.orderStatus ?? "AA");
    } catch { /* try next endpoint */ }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const raw = await redis.get(`wms:b2ccluster:${id}`);
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 });

  const cluster = (typeof raw === "string" ? JSON.parse(raw) : raw) as B2CCluster;

  // Idempotency: if already completed, skip WMS status-change to prevent DA→CA regression
  if (cluster.status === "completed") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Mark completed in Redis first so concurrent calls are idempotent
  const updated: B2CCluster = {
    ...cluster,
    status: "completed",
    completedAt: new Date().toISOString(),
  };
  await redis.set(`wms:b2ccluster:${id}`, updated, { ex: CLUSTER_TTL });

  // Change eligible order statuses to CA (Packing Request).
  // Pre-flight: check each order's current WMS status and skip any that are
  // already at DA/FA or beyond — sending CA to those would revert packing progress.
  const auth = req.headers.get("authorization");
  const skipped: string[] = [];
  const sent: string[] = [];

  if (auth) {
    const grouped = new Map<string, string[]>();
    for (const bin of cluster.bins) {
      if (!grouped.has(bin.customerCode)) grouped.set(bin.customerCode, []);
      grouped.get(bin.customerCode)!.push(bin.orderCode);
    }

    await Promise.all(
      Array.from(grouped.entries()).map(async ([customerCode, orderCodes]) => {
        // Check current status for each order in parallel
        const statusChecks = await Promise.all(
          orderCodes.map(async (code) => ({
            code,
            status: await fetchOrderStatus(cluster.warehouseCode, customerCode, code, auth),
          })),
        );

        // Split: safe to CA vs already processed
        const eligible: string[] = [];
        for (const { code, status } of statusChecks) {
          if (status && SKIP_CA_STATUSES.has(status)) {
            skipped.push(code); // DA/FA — do not revert
          } else {
            eligible.push(code); // AA, CA, or unknown — safe to CA
            sent.push(code);
          }
        }

        if (eligible.length === 0) return;

        await fetch(`${WMS_BASE}/shipping/status-change`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: auth },
          body: JSON.stringify({
            warehouseCode: cluster.warehouseCode,
            customerCode,
            orderCodes: eligible,
            newStatus: "CA",
            completeDate: "",
            cancelComment: "",
          }),
        }).catch(() => {});
      }),
    );
  }

  return NextResponse.json({ ok: true, sent: sent.length, skipped: skipped.length, skippedOrders: skipped });
}
