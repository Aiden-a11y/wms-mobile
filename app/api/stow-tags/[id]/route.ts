import { NextRequest, NextResponse } from "next/server";
import redis from "@/lib/redis";
import type { PersistedStowTag } from "@/lib/stow-tags";

const HASH_KEY = "stow_tags";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const raw = await redis.hget(HASH_KEY, id);
    if (!raw) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const tag: PersistedStowTag = typeof raw === "string" ? JSON.parse(raw) : (raw as PersistedStowTag);

    // Optional body: { remainingQty: number }
    let body: { remainingQty?: number } = {};
    try { body = await req.json(); } catch { /* no body — mark done */ }

    if (typeof body.remainingQty === "number" && body.remainingQty > 0) {
      // Partial stow — update qty, keep pending
      tag.qty = body.remainingQty;
    } else {
      // Full stow — mark done
      tag.stowedAt = new Date().toISOString();
    }

    await redis.hset(HASH_KEY, { [id]: JSON.stringify(tag) });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("PATCH /api/stow-tags/[id]", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await redis.hdel(HASH_KEY, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/stow-tags/[id]", e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
