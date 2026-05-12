"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ChevronLeft, RefreshCw, CheckCircle2, Tag, ScanLine, AlertCircle } from "lucide-react";
import { authHeaders } from "@/lib/api";
import type { PersistedStowTag } from "@/lib/stow-tags";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = {
  background: "rgba(255,255,255,0.06)",
  backdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.08)",
};

type Row = Record<string, unknown>;

function getItemKey(item: Row, idx: number): string {
  return String(item.productSku ?? item.sku ?? item.skuCode ?? idx);
}

export default function InboundOrderPage() {
  const router = useRouter();
  const params = useParams();
  const code = String(params.code ?? "");

  const [order, setOrder] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [completedKeys, setCompletedKeys] = useState<Set<string>>(new Set());
  const [taggedQtyMap, setTaggedQtyMap] = useState<Record<number, number>>({});
  const [scan, setScan] = useState("");
  const [scanError, setScanError] = useState("");

  // localStorage에서 완료 항목 로드
  useEffect(() => {
    if (!code) return;
    try {
      const saved = localStorage.getItem(`wms_receiving_${code}`);
      if (saved) setCompletedKeys(new Set(JSON.parse(saved)));
    } catch {}
  }, [code]);

  useEffect(() => {
    if (!code) return;
    async function fetchData() {
      setLoading(true);
      try {
        const [orderRes, itemsRes, tagsRes] = await Promise.all([
          fetch(`/api/wms/receiving/${code}`, { headers: authHeaders() }),
          fetch(`/api/wms/receiving/items/${code}`, { headers: authHeaders() }),
          fetch("/api/stow-tags"),
        ]);
        const orderJson = await orderRes.json();
        const itemsJson = await itemsRes.json().catch(() => null);
        setOrder((orderJson?.data ?? orderJson) as Row);
        const list: Row[] =
          Array.isArray(itemsJson?.data?.items) ? itemsJson.data.items :
          Array.isArray(itemsJson?.data?.list)  ? itemsJson.data.list :
          Array.isArray(itemsJson?.data)        ? itemsJson.data : [];
        setItems(list);

        if (tagsRes.ok) {
          const allTags: PersistedStowTag[] = await tagsRes.json().catch(() => []);
          const qtyMap: Record<number, number> = {};
          for (const tag of allTags) {
            if (tag.orderCode === code && !tag.stowedAt) {
              qtyMap[tag.receiveItemId] = (qtyMap[tag.receiveItemId] ?? 0) + tag.qty;
            }
          }
          setTaggedQtyMap(qtyMap);
        }
      } catch {}
      setLoading(false);
    }
    fetchData();
  }, [code]);

  function navigateToItem(skuKey: string) {
    if (!skuKey) return;
    const idx = items.findIndex((item, i) =>
      getItemKey(item, i).toLowerCase() === skuKey.toLowerCase()
    );
    if (idx === -1) { setScanError(`"${skuKey}" not found`); return; }
    setScanError(""); setScan("");
    router.push(`/inbound/${code}/${idx}`);
  }

  const allDone = items.length > 0 && items.every((item, i) => completedKeys.has(getItemKey(item, i)));

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      {/* Header */}
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white font-mono truncate">{code}</p>
          {order && (
            <p className="text-xs text-slate-400 truncate">
              {String(order.customerName ?? order.customerCode ?? "")}
            </p>
          )}
        </div>
        <span className="text-xs text-slate-400 flex-shrink-0">
          <span className="text-white font-semibold">{completedKeys.size}</span>/{items.length}
        </span>
      </header>

      <main className="flex-1 px-4 pt-4 pb-8 space-y-3 overflow-y-auto">
        {/* Scan */}
        <div className="rounded-2xl p-4" style={GLASS}>
          <div className="flex items-center gap-2 mb-3">
            <ScanLine className="w-4 h-4 text-blue-400" />
            <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider">Scan SKU</p>
          </div>
          <input
            type="text"
            value={scan}
            onChange={(e) => { setScan(e.target.value); setScanError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") navigateToItem(scan.trim()); }}
            placeholder="Scan SKU barcode..."
            autoFocus
            className="w-full bg-transparent border-0 border-b border-slate-600 focus:border-blue-500 outline-none text-white text-sm py-2 placeholder:text-slate-600"
          />
          {scanError && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 mt-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{scanError}
            </div>
          )}
        </div>

        {/* Order info */}
        {order && (
          <div className="rounded-2xl p-4 grid grid-cols-2 gap-3" style={GLASS}>
            {[
              ["PO", String(order.poNum ?? order.poNo ?? "-")],
              ["ETA", String(order.etaDate ?? "-")],
              ["Container", String(order.containerNo ?? "-")],
              ["Date", String(order.orderDate ?? "-")],
            ].map(([label, val]) => (
              <div key={label}>
                <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
                <p className="text-xs font-semibold text-slate-200 mt-0.5 truncate">{val}</p>
              </div>
            ))}
          </div>
        )}

        {/* Complete banner */}
        {allDone && (
          <div className="rounded-2xl p-4 flex items-center gap-3"
            style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)" }}>
            <CheckCircle2 className="w-5 h-5 text-green-400 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-300">All items complete</p>
              <p className="text-xs text-green-500 mt-0.5">Proceed to stow process</p>
            </div>
          </div>
        )}

        {/* Item list */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item, idx) => {
              const key = getItemKey(item, idx);
              const done = completedKeys.has(key);
              const itemId = Number(item.receiveItemId ?? item.itemId ?? idx);
              const tagged = taggedQtyMap[itemId] ?? 0;
              const orderQty = Number(item.orderQty ?? 0);
              const tagComplete = orderQty > 0 && tagged >= orderQty;

              return (
                <button
                  key={idx}
                  onClick={() => router.push(`/inbound/${code}/${idx}`)}
                  className="w-full rounded-2xl p-4 text-left active:scale-[0.98] transition-all"
                  style={done
                    ? { background: "rgba(34,197,94,0.10)", border: "1px solid rgba(34,197,94,0.25)" }
                    : GLASS
                  }
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-slate-500 font-mono">#{String(item.seq ?? idx + 1)}</span>
                        {done && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                      </div>
                      <p className={`text-sm font-bold font-mono truncate ${done ? "text-green-300" : "text-white"}`}>
                        {String(item.productSku ?? item.sku ?? "-")}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate">
                        {String(item.productName ?? "-")}
                      </p>
                      {Boolean(item.lotNo || item.expireDate) && (
                        <p className="text-xs text-slate-500 mt-1 font-mono">
                          {item.lotNo ? `LOT: ${String(item.lotNo)}` : ""}
                          {item.lotNo && item.expireDate ? "  ·  " : ""}
                          {item.expireDate ? `EXP: ${String(item.expireDate).slice(0, 10)}` : ""}
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-slate-500 mb-0.5">Order</p>
                      <p className="text-base font-bold text-white">{String(item.orderQty ?? "-")}</p>
                      {tagged > 0 && (
                        <div className="flex items-center gap-1 justify-end mt-1">
                          <Tag className="w-3 h-3" style={{ color: tagComplete ? "#4ade80" : "#60a5fa" }} />
                          <p className="text-xs font-semibold" style={{ color: tagComplete ? "#4ade80" : "#60a5fa" }}>
                            {tagged}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
