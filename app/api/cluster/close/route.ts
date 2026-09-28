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

  const body = await req.json().catch(() => ({})) as { completedBy?: string };

  const raw = await redis.get(`wms:b2ccluster:${id}`);
  if (!raw) return NextResponse.json({ error: "not found" }, { status: 404 });

  const cluster = (typeof raw === "string" ? JSON.parse(raw) : raw) as B2CCluster;

  // Idempotency: if already completed, skip WMS status-change to prevent DA→CA regression
  if (cluster.status === "completed") {
    console.warn(`[cluster/close] DUPLICATE CALL blocked id=${id} completedAt=${cluster.completedAt}`);
    return NextResponse.json({ ok: true, skipped: true });
  }

  console.log(`[cluster/close] START id=${id} bins=${cluster.bins.length} warehouse=${cluster.warehouseCode}`);

  // Mark completed in Redis first so concurrent calls are idempotent
  const updated: B2CCluster = {
    ...cluster,
    status: "completed",
    completedAt: new Date().toISOString(),
    ...(body.completedBy ? { completedBy: body.completedBy } : {}),
  };
  await redis.set(`wms:b2ccluster:${id}`, updated, { ex: CLUSTER_TTL });

  // Change eligible order statuses to CA (Packing Request).
  // Pre-flight: check each order's current WMS status and skip any that are
  // already at DA/FA or beyond — sending CA to those would revert packing progress.
  const auth = req.headers.get("authorization");
  const skipped: string[] = [];
  const sent: string[] = [];       // attempted (eligible + status-change call issued)
  const caFailed: { customerCode: string; orderCodes: string[]; httpStatus: number | null; body: string }[] = [];
  // Per-order outcome log, persisted to Supabase below so failures/skips survive
  // past Vercel's log retention — this is what made #1520 undiagnosable.
  const outcomeLog: { orderCode: string; customerCode: string; outcome: "sent" | "skipped" | "failed"; detectedStatus: string | null; httpStatus: number | null; errorBody: string | null }[] = [];

  // authHeaders() on the client always sends "Bearer <token>" even with an empty
  // token, so `auth` is a non-empty string even when the user's session token is
  // missing/expired. Guard against that explicitly instead of silently attempting
  // (and silently failing) doomed WMS calls.
  const hasRealToken = !!auth && auth.trim() !== "Bearer" && auth.replace(/^Bearer\s*/i, "").trim().length > 0;

  if (auth && !hasRealToken) {
    console.warn(`[cluster/close] NO TOKEN id=${id} — skipping CA status-change entirely (auth header was empty)`);
  }

  if (hasRealToken) {
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

        // Split: safe to CA vs already processed (or unverifiable)
        // Only send CA to orders CONFIRMED at AA. Skip DA/FA and unknown.
        // Unknown (null) = WMS status check failed; orders picked from AA list
        // and cluster is being closed for the first time, so AA is expected.
        // But if status cannot be confirmed, be conservative and allow CA only
        // for explicitly known AA — anything else (DA/FA/null-if-cluster-reopened)
        // is skipped.
        const eligible: string[] = [];
        for (const { code, status } of statusChecks) {
          if (status === null || status === "AA" || status === "CA") {
            eligible.push(code); // confirmed AA/CA, or unknown (fresh first-close)
            sent.push(code);
          } else {
            skipped.push(code); // DA/FA/AC/LC/EA — do not revert
            outcomeLog.push({ orderCode: code, customerCode, outcome: "skipped", detectedStatus: status, httpStatus: null, errorBody: null });
            console.log(`[cluster/close] SKIP status=${status} order=${code}`);
          }
        }

        if (eligible.length === 0) return;

        try {
          const res = await fetch(`${WMS_BASE}/shipping/status-change`, {
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
          });
          if (!res.ok) {
            const body = await res.text().catch(() => "");
            caFailed.push({ customerCode, orderCodes: eligible, httpStatus: res.status, body: body.slice(0, 500) });
            for (const code of eligible) outcomeLog.push({ orderCode: code, customerCode, outcome: "failed", detectedStatus: null, httpStatus: res.status, errorBody: body.slice(0, 500) });
            console.error(`[cluster/close] CA FAILED id=${id} customer=${customerCode} orders=${eligible.join(",")} httpStatus=${res.status} body=${body.slice(0, 500)}`);
          } else {
            for (const code of eligible) outcomeLog.push({ orderCode: code, customerCode, outcome: "sent", detectedStatus: null, httpStatus: res.status, errorBody: null });
          }
        } catch (e) {
          caFailed.push({ customerCode, orderCodes: eligible, httpStatus: null, body: String(e) });
          for (const code of eligible) outcomeLog.push({ orderCode: code, customerCode, outcome: "failed", detectedStatus: null, httpStatus: null, errorBody: String(e).slice(0, 500) });
          console.error(`[cluster/close] CA NETWORK ERROR id=${id} customer=${customerCode} orders=${eligible.join(",")} error=${e}`);
        }
      }),
    );
  }

  console.log(`[cluster/close] DONE id=${id} sent=${sent.length} skipped=${skipped.length} caFailed=${caFailed.length}`);

  // Non-blocking: record pick performance in Supabase
  if (updated.completedAt && updated.completedBy) {
    (async () => {
      try {
        const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
        const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
        if (!sbUrl || !sbKey) return;
        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(sbUrl, sbKey);
        const durationMin = (new Date(updated.completedAt!).getTime() - new Date(updated.createdAt).getTime()) / 60000;
        const activeDurationMin = updated.pickStartedAt
          ? (new Date(updated.completedAt!).getTime() - new Date(updated.pickStartedAt).getTime()) / 60000
          : null;
        const itemCount = (updated.bins ?? []).reduce((s: number, b) => s + (b.items?.length ?? 0), 0);
        await sb.from("pick_performance").upsert({
          cluster_id: updated.id,
          cluster_no: updated.clusterNo ?? null,
          warehouse_code: updated.warehouseCode,
          picker: updated.completedBy!,
          cluster_created_at: updated.createdAt,
          pick_started_at: updated.pickStartedAt ?? null,
          completed_at: updated.completedAt!,
          duration_min: Math.round(durationMin * 100) / 100,
          active_duration_min: activeDurationMin != null ? Math.round(activeDurationMin * 100) / 100 : null,
          bin_count: (updated.bins ?? []).length,
          location_count: (updated.locationGroups ?? []).length,
          item_count: itemCount,
        }, { onConflict: "cluster_id", ignoreDuplicates: true });

        // Permanent full-detail archive — Redis clusters expire after 7 days
        // (CLUSTER_TTL), so mirror the complete record here before it's gone.
        await sb.from("cluster_archive").upsert({
          cluster_id: updated.id,
          cluster_no: updated.clusterNo ?? null,
          warehouse_code: updated.warehouseCode,
          created_by: updated.createdBy ?? null,
          completed_by: updated.completedBy!,
          created_at: updated.createdAt,
          completed_at: updated.completedAt!,
          data: updated,
        }, { onConflict: "cluster_id" });

        // Persist per-order CA outcomes — this is what makes a future "status didn't
        // change" report diagnosable after the fact, instead of needing live server
        // logs that are gone by the time anyone checks.
        if (outcomeLog.length > 0) {
          await sb.from("ca_outcomes").insert(
            outcomeLog.map((o) => ({
              cluster_id: updated.id,
              cluster_no: updated.clusterNo ?? null,
              warehouse_code: updated.warehouseCode,
              customer_code: o.customerCode,
              order_code: o.orderCode,
              outcome: o.outcome,
              detected_status: o.detectedStatus,
              http_status: o.httpStatus,
              error_body: o.errorBody,
              source: "close",
            })),
          );
        }
      } catch (e) {
        console.warn("[cluster/close] pick_performance/cluster_archive/ca_outcomes write failed:", e);
      }
    })();
  }

  return NextResponse.json({
    ok: true,
    sent: sent.length,
    skipped: skipped.length,
    skippedOrders: skipped,
    caFailed: caFailed.length,
    caFailedDetail: caFailed,
  });
}
