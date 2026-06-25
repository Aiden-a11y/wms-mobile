"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, RefreshCw, AlertCircle, Loader2, Layers, Package } from "lucide-react";
import { authHeaders } from "@/lib/api";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };

interface WmsBatch {
  batchCode: string;
  batchName: string;
  batchDate: string;
  orderCount: number;
  itemCount: number;
  totalQty: number;
  warehouseCode: string;
  customerCode: string;
}

function fmtDate(d: string) {
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d;
}

export default function WmsBatchListPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<WmsBatch[]>([]);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warehouseCode] = useState("STOO1");
  const [customerCode] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError(""); setBatches([]);
    try {
      const today = new Date();
      const from = new Date(today); from.setDate(from.getDate() - 14);
      const dateFrom = from.toISOString().slice(0, 10).replace(/-/g, "");
      const dateTo = today.toISOString().slice(0, 10).replace(/-/g, "");

      const res = await fetch("/api/wms/batch/list", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ searchText: "", warehouseCode, customerCode, dateFrom, dateTo, page: 1, pageSize: 200 }),
      });
      const json = await res.json().catch(() => ({}));
      const list: WmsBatch[] = Array.isArray(json?.data) ? json.data : [];

      if (!list.length) { setLoading(false); return; }

      // Filter: only show batches where the first order has location assignments
      setChecking(true);
      const results = await Promise.all(
        list.map(async (batch) => {
          try {
            // Get first order of this batch
            const ordRes = await fetch("/api/wms/batch/orders", {
              method: "POST",
              headers: authHeaders(),
              body: JSON.stringify([batch.batchCode]),
            });
            const ordJson = await ordRes.json().catch(() => ({}));
            const orders: { shippingOrderCode: string }[] = Array.isArray(ordJson?.data) ? ordJson.data : [];
            if (!orders.length) return null;

            const firstCode = orders[0].shippingOrderCode;
            const itemRes = await fetch(`/api/wms/shipping/items/${encodeURIComponent(firstCode)}`, { headers: authHeaders() });
            const itemJson = await itemRes.json().catch(() => ({}));
            const d = (itemJson?.data ?? {}) as Record<string, unknown>;
            const assignments = Array.isArray(d.assignments) ? d.assignments : [];
            return assignments.length > 0 ? batch : null;
          } catch {
            return null;
          }
        })
      );

      setBatches(results.filter(Boolean) as WmsBatch[]);
      setChecking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setChecking(false);
    }
  }, [warehouseCode, customerCode]);

  useEffect(() => { load(); }, [load]);

  const busy = loading || checking;

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-base font-bold text-white">Batch Pick</p>
          <p className="text-xs text-slate-400">WMS batches with assigned locations</p>
        </div>
        <button onClick={load} disabled={busy} className="p-1 text-slate-400 active:text-white transition-colors">
          <RefreshCw className={`w-5 h-5 ${busy ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="flex-1 px-4 pt-4 pb-8 space-y-4 overflow-y-auto">
        {/* Loading states */}
        {loading && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl text-xs text-slate-400"
            style={GLASS}>
            <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
            Loading batches…
          </div>
        )}
        {!loading && checking && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl text-xs text-violet-300"
            style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)" }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking location assignments…
          </div>
        )}

        {error && (
          <div className="rounded-2xl p-4 flex items-start gap-3"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {!busy && !error && batches.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)" }}>
              <Layers className="w-7 h-7 text-violet-400" />
            </div>
            <p className="text-sm font-semibold text-slate-300">No batches ready</p>
            <p className="text-xs text-slate-500 max-w-[220px]">
              Assign locations in the dashboard first, then come back here to pick.
            </p>
          </div>
        )}

        {batches.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={GLASS}>
            <div className="px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(139,92,246,0.12)" }}>
              <div className="flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-violet-400" />
                <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider">
                  {batches.length} batch{batches.length !== 1 ? "es" : ""} ready to pick
                </p>
              </div>
            </div>
            {batches.map((batch, i) => (
              <button
                key={batch.batchCode}
                onClick={() => router.push(`/outbound/wmsbatch/${encodeURIComponent(batch.batchCode)}?wh=${batch.warehouseCode}&cust=${batch.customerCode}&name=${encodeURIComponent(batch.batchName)}&date=${batch.batchDate}&orders=${batch.orderCount}`)}
                className="w-full px-4 py-3.5 flex items-center gap-3 active:bg-white/5 text-left transition-colors"
                style={i < batches.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}>
                {/* Icon */}
                <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(139,92,246,0.15)", border: "1px solid rgba(139,92,246,0.25)" }}>
                  <Package className="w-5 h-5 text-violet-400" />
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-white truncate">{batch.batchName || batch.batchCode}</p>
                  <p className="font-mono text-xs text-slate-500 truncate mt-0.5">{batch.batchCode}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-violet-300 font-semibold">{batch.orderCount} orders</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-xs text-slate-500">{fmtDate(batch.batchDate)}</span>
                  </div>
                </div>
                <span className="text-slate-500 text-xl flex-shrink-0">›</span>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
