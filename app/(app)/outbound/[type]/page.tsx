"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { authHeaders } from "@/lib/api";
import { ChevronLeft, RefreshCw, Search, AlertCircle } from "lucide-react";

const TYPE_LABEL: Record<string, string> = {
  b2b: "B2B", b2c: "B2C", b2s: "B2S", b2e: "B2E",
};

const STATUS_META: Record<string, { label: string; badge: string }> = {
  AA: { label: "Pre-Alert",        badge: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  CA: { label: "Packing Request",  badge: "bg-blue-50 text-blue-700 border-blue-200" },
  DA: { label: "Packing Complete", badge: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  FA: { label: "Complete",         badge: "bg-green-50 text-green-700 border-green-200" },
  HA: { label: "Hold",             badge: "bg-red-50 text-red-700 border-red-200" },
  CC: { label: "Cancelled",        badge: "bg-slate-100 text-slate-500 border-slate-200" },
};

interface Order { [k: string]: unknown }

export default function OrderListPage() {
  const router = useRouter();
  const { type } = useParams<{ type: string }>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [warehouseCode, setWarehouseCode] = useState("STOO1");

  async function load() {
    setLoading(true); setError("");
    const body = { page: 1, limit: 200, pageSize: 200, orderType: type.toUpperCase(), warehouseCode };
    for (const ep of [`/api/wms/shipping/${type}/list`, `/api/wms/outbound/${type}/list`]) {
      try {
        const res = await fetch(ep, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
        const json = await res.json();
        const list = json?.data?.list ?? json?.data?.items ?? json?.data ?? (Array.isArray(json) ? json : []);
        if (res.ok && Array.isArray(list)) { setOrders(list); setLoading(false); return; }
      } catch { /* try next */ }
    }
    setError("주문을 불러올 수 없습니다."); setLoading(false);
  }

  useEffect(() => { load(); }, [type, warehouseCode]); // eslint-disable-line

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => Object.values(o).some((v) => String(v).toLowerCase().includes(q)));
  }, [orders, search]);

  const typeLabel = TYPE_LABEL[type] ?? type.toUpperCase();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-5 py-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => router.back()} className="p-1 text-slate-400 hover:text-slate-700">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-base font-bold text-slate-900">{typeLabel} Picking</p>
          <p className="text-xs text-slate-500">피킹 주문 목록</p>
        </div>
        <button onClick={load} disabled={loading} className="p-2 text-slate-400 hover:text-slate-700">
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <div className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="오더코드, 고객명 검색…"
            className="w-full h-10 border border-slate-200 rounded-xl pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-4">
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-4">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}
        {loading && (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-slate-100 h-20 animate-pulse" />
            ))}
          </div>
        )}
        {!loading && filtered.length === 0 && !error && (
          <div className="text-center py-20 text-slate-400">
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
            const sm = STATUS_META[status] ?? { label: status, badge: "bg-slate-100 text-slate-500 border-slate-200" };
            return (
              <button key={i} onClick={() => router.push(`/outbound/${type}/${code}`)}
                className="w-full bg-white border border-slate-200 rounded-2xl p-4 text-left shadow-sm hover:shadow-md active:scale-[0.98] transition-all">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="font-mono text-sm font-semibold text-slate-900">{code}</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ${sm.badge}`}>{sm.label}</span>
                </div>
                <p className="text-sm text-slate-600 mb-1">{customer}</p>
                <div className="flex items-center gap-4 text-xs text-slate-400">
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
