"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { authHeaders } from "@/lib/api";
import { buildPickList, savePickList, loadPickList } from "@/lib/picking";
import { ChevronLeft, RefreshCw, Search, AlertCircle, ScanLine, Loader2 } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  b2b: "B2B", b2c: "B2C", b2s: "B2S", b2e: "B2E",
};

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  AA: { label: "Pre-Alert",            color: "#fde047", bg: "rgba(234,179,8,0.15)",   border: "rgba(234,179,8,0.3)" },
  CA: { label: "Packing Request",      color: "#93c5fd", bg: "rgba(59,130,246,0.15)",  border: "rgba(59,130,246,0.3)" },
  DA: { label: "Packing Complete",     color: "#67e8f9", bg: "rgba(6,182,212,0.15)",   border: "rgba(6,182,212,0.3)" },
  AR: { label: "Auto Label Request",   color: "#c4b5fd", bg: "rgba(139,92,246,0.15)",  border: "rgba(139,92,246,0.3)" },
  AC: { label: "Auto Label Complete",  color: "#a5b4fc", bg: "rgba(99,102,241,0.15)",  border: "rgba(99,102,241,0.3)" },
  LR: { label: "Twinny Pack Request",  color: "#fcd34d", bg: "rgba(245,158,11,0.15)",  border: "rgba(245,158,11,0.3)" },
  LC: { label: "Twinny Pack Complete", color: "#5eead4", bg: "rgba(20,184,166,0.15)",  border: "rgba(20,184,166,0.3)" },
  FA: { label: "Complete",             color: "#86efac", bg: "rgba(34,197,94,0.15)",   border: "rgba(34,197,94,0.3)" },
  HA: { label: "Hold",                 color: "#fca5a5", bg: "rgba(239,68,68,0.15)",   border: "rgba(239,68,68,0.3)" },
  CC: { label: "Cancelled",            color: "#94a3b8", bg: "rgba(100,116,139,0.15)", border: "rgba(100,116,139,0.3)" },
};

const DARK_BG = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const CARD = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };

interface Order { [k: string]: unknown }

export default function OrderListPage() {
  const router = useRouter();
  const { type } = useParams<{ type: string }>();
  const scanRef = useRef<HTMLInputElement>(null);

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [scanInput, setScanInput] = useState("");
  const [building, setBuilding] = useState<string | null>(null); // order code being built

  // Fetch correct warehouse code first
  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers: authHeaders() })
      .then((r) => r.json())
      .then((json) => {
        const arr: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        const list = arr.map((w) => ({ id: String(w.code ?? w.id ?? ""), name: String(w.name ?? w.code ?? "") })).filter((w) => w.id);
        const pref = list.find((w) => w.id === "STOO1") ?? list[0];
        if (pref) setWarehouseCode(pref.id);
      })
      .catch(() => {});
  }, []); // eslint-disable-line

  async function load(whCode = warehouseCode) {
    setLoading(true); setError("");
    const body = { page: 1, limit: 500, pageSize: 500, orderType: type.toUpperCase(), warehouseCode: whCode };
    for (const ep of [`/api/wms/shipping/${type}/list`, `/api/wms/shipping/list`, `/api/wms/outbound/${type}/list`, `/api/wms/outbound/list`]) {
      try {
        const res = await fetch(ep, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
        const json = await res.json().catch(() => null);
        if (!json) continue;
        const list = json?.data?.list ?? json?.data?.items ?? json?.data ?? json?.list ?? json?.items ?? (Array.isArray(json) ? json : []);
        if (res.ok) { setOrders(Array.isArray(list) ? list : []); setLoading(false); return; }
        setError(`HTTP ${res.status}: ${json?.message ?? ep}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [type, warehouseCode]); // eslint-disable-line

  // Build pick list and navigate directly to first pending pick step
  // custCodeHint: customerCode from the order list row (avoids extra detail fetch)
  async function startPicking(code: string, custCodeHint?: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBuilding(trimmed);
    setError("");

    // Use cached pick list if available
    const cached = loadPickList(trimmed);
    if (cached && cached.length > 0) {
      const nextIdx = cached.findIndex((t) => t.status === "pending");
      if (nextIdx >= 0) {
        router.push(`/outbound/${type}/${trimmed}/pick/${nextIdx}`);
      } else {
        router.push(`/outbound/${type}/${trimmed}/complete`);
      }
      setBuilding(null);
      return;
    }

    try {
      // 1. customerCode 확보: hint → 오더 목록 검색 → detail 조회
      let custCode = custCodeHint ?? "";
      let detailData: Record<string, unknown> = {};

      if (!custCode) {
        // 현재 목록에서 먼저 검색
        const found = orders.find((o) => {
          const c = String(o.shippingOrderCode ?? o.orderCode ?? o.outboundCode ?? "");
          return c === trimmed;
        });
        if (found) {
          custCode = String(found.customerCode ?? found.custCode ?? "");
        }
      }

      if (!custCode) {
        // detail 엔드포인트 시도
        for (const ep of [
          `/api/wms/shipping/${type}/${trimmed}`,
          `/api/wms/shipping/detail/${trimmed}`,
          `/api/wms/outbound/${type}/${trimmed}`,
        ]) {
          try {
            const r = await fetch(ep, { headers: authHeaders() });
            const j = await r.json().catch(() => null);
            if (!j) continue;
            const d = (j?.data ?? j) as Record<string, unknown>;
            if (d && typeof d === "object" && !Array.isArray(d)) {
              detailData = d;
              const c = String(d.customerCode ?? d.custCode ?? d.consignorCode ?? "");
              if (c) { custCode = c; break; }
            }
          } catch { /* try next */ }
        }
      }

      // 2. 아이템 엔드포인트 시도
      let rawItems: unknown[] = [];
      for (const ep of [
        `/api/wms/shipping/${type}/items/${trimmed}`,
        `/api/wms/shipping/items/${trimmed}`,
      ]) {
        try {
          const r = await fetch(ep, { headers: authHeaders() });
          const j = await r.json().catch(() => null);
          const list =
            j?.data?.items ?? j?.data?.list ?? j?.data ??
            j?.items ?? j?.list ?? (Array.isArray(j) ? j : null);
          if (r.ok && Array.isArray(list) && list.length > 0) {
            rawItems = list;
            break;
          }
        } catch { /* try next */ }
      }

      // 3. detail 안에 인라인 아이템이 있으면 활용
      if (rawItems.length === 0 && Object.keys(detailData).length > 0) {
        const inline =
          detailData.itemList ?? detailData.items ??
          detailData.shippingItemList ?? detailData.orderItems;
        if (Array.isArray(inline) && inline.length > 0) rawItems = inline;
      }

      // 4. 아이템이 없으면 detail을 다시 시도하며 인라인 아이템 추출
      if (rawItems.length === 0) {
        for (const ep of [
          `/api/wms/shipping/${type}/${trimmed}`,
          `/api/wms/shipping/detail/${trimmed}`,
        ]) {
          try {
            const r = await fetch(ep, { headers: authHeaders() });
            const j = await r.json().catch(() => null);
            const d = (j?.data ?? j) as Record<string, unknown>;
            const inline = d?.itemList ?? d?.items ?? d?.shippingItemList ?? d?.orderItems;
            if (Array.isArray(inline) && inline.length > 0) {
              rawItems = inline;
              if (!custCode) custCode = String(d.customerCode ?? d.custCode ?? "");
              break;
            }
          } catch { /* try next */ }
        }
      }

      if (rawItems.length === 0) {
        setError(`오더 아이템을 찾을 수 없습니다 (코드: ${trimmed})`);
        setBuilding(null);
        return;
      }

      const list = await buildPickList(rawItems as Record<string, unknown>[], warehouseCode, custCode);

      if (list.length === 0) {
        // 진단 정보 표시
        const firstItem = rawItems[0] as Record<string, unknown>;
        const sampleSku = String(firstItem?.productSku ?? firstItem?.sku ?? firstItem?.itemCode ?? "?");
        const invRes = await fetch("/api/wms/inventory/detail", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ warehouseCode, customerCode: custCode, productSku: sampleSku }),
        });
        const invJson = await invRes.json().catch(() => null);
        setError(
          `재고 로케이션 없음\n` +
          `custCode=${custCode || "(없음)"} sku=${sampleSku}\n` +
          `[재고응답] ${JSON.stringify(invJson).slice(0, 300)}\n` +
          `[아이템키] ${Object.keys(firstItem).join(", ")}`
        );
        setBuilding(null);
        return;
      }

      savePickList(trimmed, list);
      const nextIdx = list.findIndex((t) => t.status === "pending");
      router.push(`/outbound/${type}/${trimmed}/pick/${nextIdx >= 0 ? nextIdx : 0}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "피킹 목록 구성 실패");
      setBuilding(null);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => Object.values(o).some((v) => String(v).toLowerCase().includes(q)));
  }, [orders, search]);

  const typeLabel = TYPE_LABEL[type] ?? type.toUpperCase();

  return (
    <div className="min-h-screen flex flex-col" style={DARK_BG}>
      {/* Building overlay */}
      {building && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
          style={{ background: "rgba(8,13,26,0.92)", backdropFilter: "blur(8px)" }}>
          <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
          <p className="text-white font-semibold text-base">피킹 목록 구성 중…</p>
          <p className="text-slate-400 font-mono text-sm">{building}</p>
        </div>
      )}

      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-base font-bold text-white">{typeLabel} Picking</p>
          <p className="text-xs text-slate-400">피킹 주문 목록</p>
        </div>
        <button onClick={() => load()} disabled={loading} className="p-2 text-slate-400 active:text-white transition-colors">
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {/* Scan input */}
      <div className="px-4 pt-3 pb-2" style={HDR_BORDER}>
        <div className="relative mb-2">
          <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
          <input
            ref={scanRef}
            type="text"
            value={scanInput}
            onChange={(e) => setScanInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                startPicking(scanInput);
                setScanInput("");
              }
            }}
            placeholder="오더코드 스캔 또는 입력 후 Enter"
            className="w-full h-11 rounded-xl pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:outline-none"
            style={{ background: "rgba(59,130,246,0.1)", border: "1px solid rgba(59,130,246,0.35)" }}
          />
        </div>
        {/* Search / filter */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="목록 검색…"
            className="w-full h-9 rounded-xl pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm text-red-300 mb-4"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}
        {loading && (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="rounded-2xl h-20 animate-pulse"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }} />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <div className="text-center py-20 text-slate-500">
            <p className="text-sm">주문이 없습니다</p>
          </div>
        )}
        <div className="space-y-3">
          {filtered.map((order, i) => {
            const code = String(order.shippingOrderCode ?? order.orderCode ?? order.outboundCode ?? "");
            const customer = String(order.customerName ?? order.customerCode ?? "-");
            const status = String(order.status ?? order.orderStatus ?? "");
            const qty = String(order.totalQty ?? order.qty ?? "-");
            const date = String(order.orderDate ?? "-");
            const sm = STATUS_META[status] ?? { label: status, color: "#94a3b8", bg: "rgba(100,116,139,0.15)", border: "rgba(100,116,139,0.3)" };
            return (
              <button key={i} onClick={() => startPicking(code, String(order.customerCode ?? order.custCode ?? ""))}
                className="w-full rounded-2xl p-4 text-left active:scale-[0.98] transition-all"
                style={CARD}>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-mono text-sm font-semibold text-white">{code}</p>
                  {sm.label && (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0"
                      style={{ color: sm.color, background: sm.bg, border: `1px solid ${sm.border}` }}>
                      {sm.label}
                    </span>
                  )}
                </div>
                <p className="text-sm text-slate-300 mb-1">{customer}</p>
                <div className="flex items-center gap-4 text-xs text-slate-500">
                  <span>수량 {qty}</span>
                  <span>주문일 {date}</span>
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
