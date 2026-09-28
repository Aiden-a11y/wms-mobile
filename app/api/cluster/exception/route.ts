import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      clusterId, clusterNo, warehouseCode,
      locationCode, sku, productName, binCode,
      orderCode, customerCode,
      exceptionType, shortageQty,
      reportedBy,
    } = body as Record<string, unknown>;

    if (!clusterId || !locationCode || !exceptionType || !reportedBy) {
      return NextResponse.json({ error: "missing required fields" }, { status: 400 });
    }

    const sbUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    const sbKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SERVICE_ROLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      "";
    if (!sbUrl || !sbKey) {
      return NextResponse.json({ error: "supabase not configured" }, { status: 500 });
    }

    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(sbUrl, sbKey);

    const { data, error } = await sb.from("cluster_exceptions").insert({
      cluster_id:     String(clusterId),
      cluster_no:     clusterNo != null ? Number(clusterNo) : null,
      warehouse_code: String(warehouseCode ?? ""),
      location_code:  String(locationCode),
      sku:            sku ? String(sku) : null,
      product_name:   productName ? String(productName) : null,
      bin_code:       binCode ? String(binCode) : null,
      order_code:     orderCode ? String(orderCode) : null,
      customer_code:  customerCode ? String(customerCode) : null,
      exception_type: String(exceptionType),
      shortage_qty:   shortageQty != null ? Number(shortageQty) : null,
      reported_by:    String(reportedBy),
    }).select().single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: data?.id });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
