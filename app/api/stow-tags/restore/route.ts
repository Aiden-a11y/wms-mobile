import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { PersistedStowTag } from "@/lib/stow-tags";

const HASH_KEY = "stow_tags";

// GET  → preview which tags would be restored
// POST → actually restore them
export async function GET() {
  return handler(false);
}
export async function POST() {
  return handler(true);
}

async function handler(commit: boolean) {
  try {
    const raw = await redis.hgetall(HASH_KEY);
    if (!raw) return NextResponse.json({ restored: [], total: 0 });

    const tags: PersistedStowTag[] = Object.values(raw).map((v) =>
      typeof v === "string" ? JSON.parse(v) : (v as PersistedStowTag)
    );

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    // Find tags: stowedAt today AND sku matches
    const targets = tags.filter((t) => {
      if (!t.stowedAt) return false;
      const stowedDate = t.stowedAt.slice(0, 10);
      if (stowedDate !== today) return false;
      // If sku filter provided in future — for now restore ALL done-today
      return true;
    });

    if (commit) {
      for (const t of targets) {
        const restored: PersistedStowTag = { ...t };
        delete restored.stowedAt;
        // If this is the 8809864762305 tag with original qty 252,
        // set remaining qty to 166 (252 - 86 stowed)
        if (t.sku === "8809864762305" && t.qty === 252) {
          restored.qty = 166;
        }
        await redis.hset(HASH_KEY, { [String(t.id)]: JSON.stringify(restored) });
      }
    }

    return NextResponse.json({
      preview: !commit,
      restored: targets.map((t) => ({
        id: t.id,
        tagNo: t.tagNo,
        orderCode: t.orderCode,
        sku: t.sku,
        qty: t.qty,
        stowedAt: t.stowedAt,
      })),
      total: targets.length,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
