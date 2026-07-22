import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  if (!url || !key) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const sb = createClient(url, key);
  const body = await req.json() as {
    session_id: string;
    warehouse_code: string;
    customer_code?: string | null;
    location: string;
    sku: string;
    product_name?: string | null;
    lot?: string | null;
    expire_date?: string | null;
    system_qty: number;
    counted_qty: number;
    status: "OK" | "OVER" | "SHORT";
    counted_by: string;
  };

  const difference = (body.counted_qty ?? 0) - (body.system_qty ?? 0);
  const { error } = await sb.from("cycle_count").insert({
    session_id: body.session_id,
    warehouse_code: body.warehouse_code,
    customer_code: body.customer_code ?? null,
    location: body.location,
    sku: body.sku,
    product_name: body.product_name ?? null,
    lot: body.lot ?? null,
    expire_date: body.expire_date ?? null,
    system_qty: body.system_qty ?? 0,
    counted_qty: body.counted_qty,
    difference,
    status: body.status,
    counted_by: body.counted_by,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
