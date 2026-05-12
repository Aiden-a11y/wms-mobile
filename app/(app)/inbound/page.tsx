"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ScanLine, RefreshCw, Play, RotateCcw, AlertCircle } from "lucide-react";
import { authHeaders } from "@/lib/api";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = {
  background: "rgba(255,255,255,0.06)",
  backdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.08)",
};

type Order = Record<string, unknown>;

export default function InboundPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [scan, setScan] = useState("");
  const [scanError, setScanError] = useState("");
  const [starting, setStarting] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadOrders() {
    setLoading(true);
    try {
      const res = await fetch("/api/wms/receiving/list", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ page: 1, limit: 200 }),
      });
      const json = await res.json();
      const list: Order[] = json?.data?.list ?? json?.data ?? json?.list ?? [];
      const filtered = list.filter((r) => {
        const s = String(r.status ?? "").toUpperCase();
        return s === "AA" || s === "CA";
      });
      filtered.sort((a, b) => {
        const sa = String(a.status ?? "").toUpperCase();
        const sb = String(b.status ?? "").toUpperCase();
        return sa === sb ? 0 : sa === "AA" ? -1 : 1;
      });
      setOrders(filtered);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadOrders(); }, []);

  async function startOrder(row: Order) {
    const orderCode = String(row.receiveOrderCode ?? row.orderCode ?? "");
    const status = String(row.status ?? "").toUpperCase();
    if (status === "CA") {
      router.push(`/inbound/${orderCode}`);
      return;
    }
    setStarting(orderCode);
    setScanError("");
    try {
      const res = await fetch("/api/wms/receiving/status-change", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          warehouseCode: String(row.warehouseCode ?? ""),
          customerCode: String(row.customerCode ?? ""),
          orderCodes: [orderCode],
          newStatus: "CA",
          completeDate: "",
          cancelComment: "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json?.success === false) throw new Error(json?.message ?? "Failed");
      router.push(`/inbound/${orderCode}`);
    } catch (e) {
      setScanError(String(e instanceof Error ? e.message : e));
      setStarting(null);
    }
  }

  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const code = scan.trim();
    if (!code) return;
    const match = orders.find(
      (o) => String(o.receiveOrderCode ?? o.orderCode ?? "").toLowerCase() === code.toLowerCase()
    );
    if (!match) { setScanError(`"${code}" not found`); return; }
    setScanError(""); setScan("");
    startOrder(match);
  }

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      {/* Header */}
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <p className="text-base font-bold text-white flex-1">Inbound Receiving</p>
        <button onClick={loadOrders} disabled={loading} className="p-1 text-slate-400 active:text-white">
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="flex-1 px-4 pt-4 pb-8 space-y-4 overflow-y-auto">
        {/* Scan box */}
        <div className="rounded-2xl p-4" style={GLASS}>
          <div className="flex items-center gap-2 mb-3">
            <ScanLine className="w-4 h-4 text-blue-400" />
            <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider">Order Code 스캔</p>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={scan}
            onChange={(e) => { setScan(e.target.value); setScanError(""); }}
            onKeyDown={handleScan}
            placeholder="바코드 스캔 또는 직접 입력..."
            autoFocus
            className="w-full bg-transparent border-0 border-b border-slate-600 focus:border-blue-500 outline-none text-white text-sm py-2 placeholder:text-slate-600 transition-colors"
          />
          {scanError && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 mt-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{scanError}
            </div>
          )}
        </div>

        {/* Order list */}
        {loading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-500 text-sm">활성 오더가 없습니다</p>
          </div>
        ) : (
          <div className="space-y-3">
            {orders.map((row, i) => {
              const orderCode = String(row.receiveOrderCode ?? row.orderCode ?? "");
              const status = String(row.status ?? "").toUpperCase();
              const isCA = status === "CA";
              const isStarting = starting === orderCode;

              return (
                <div key={i} className="rounded-2xl p-4 flex items-center gap-4" style={GLASS}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        isCA
                          ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                          : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                      }`}>
                        {isCA ? "In Progress" : "Pre-Alert"}
                      </span>
                    </div>
                    <p className="text-sm font-bold text-white font-mono truncate">{orderCode}</p>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                      {String(row.customerName ?? row.customerCode ?? "")}
                      {row.warehouseCode ? ` · ${row.warehouseCode}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => startOrder(row)}
                    disabled={starting !== null}
                    className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-50 flex-shrink-0"
                    style={isCA
                      ? { background: "rgba(245,158,11,0.2)", border: "1px solid rgba(245,158,11,0.4)", color: "#FCD34D" }
                      : { background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)", color: "#93C5FD" }
                    }
                  >
                    {isStarting
                      ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      : isCA
                        ? <RotateCcw className="w-3.5 h-3.5" />
                        : <Play className="w-3.5 h-3.5" />
                    }
                    {isCA ? "Resume" : "Start"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
