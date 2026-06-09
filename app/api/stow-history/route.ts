import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";

const KEY = "stow_history";
const MAX = 1000;

export interface StowHistoryEntry {
  id: string;
  at: string;            // ISO timestamp
  sku: string;
  productName?: string;
  qty: number;
  locationCode: string;  // TO (where it was stowed)
  warehouseCode?: string;
  customerCode?: string;
  orderCode?: string;    // FROM (receiving order)
  lotNo?: string;
  expireDate?: string;
  user?: string;
}

function parse(v: unknown): StowHistoryEntry | null {
  try { return typeof v === "string" ? JSON.parse(v) : (v as StowHistoryEntry); }
  catch { return null; }
}

export async function POST(req: NextRequest) {
  try {
    const e = (await req.json()) as StowHistoryEntry;
    e.id = e.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    e.at = e.at || new Date().toISOString();
    await redis.lpush(KEY, JSON.stringify(e));
    await redis.ltrim(KEY, 0, MAX - 1);
    return NextResponse.json({ ok: true, id: e.id });
  } catch (err) {
    console.error("POST /api/stow-history", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const sku = req.nextUrl.searchParams.get("sku")?.trim().toLowerCase();
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? 200);
    const raw = await redis.lrange(KEY, 0, MAX - 1);
    let list = (raw ?? []).map(parse).filter(Boolean) as StowHistoryEntry[];
    if (sku) {
      list = list.filter(
        (e) =>
          String(e.sku ?? "").toLowerCase().includes(sku) ||
          String(e.productName ?? "").toLowerCase().includes(sku),
      );
    }
    return NextResponse.json(list.slice(0, limit));
  } catch (err) {
    console.error("GET /api/stow-history", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
