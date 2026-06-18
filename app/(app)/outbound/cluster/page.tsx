"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, RefreshCw, AlertCircle, Loader2, PackageCheck, CheckSquare, Square } from "lucide-react";
import { authHeaders } from "@/lib/api";
import {
  buildClusterPickList, saveCluster, saveLocationGroups,
  listActiveClusterIds, getCluster, clearCluster,
  type ClusterBin, type Cluster,
} from "@/lib/cluster";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };

interface Order { [k: string]: unknown }

function orderCode(o: Order): string {
  return String(o.shippingOrderCode ?? o.orderCode ?? o.outboundCode ?? "");
}
function customerCode(o: Order): string {
  return String(o.customerCode ?? o.custCode ?? "");
}

export default function ClusterPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<{ done: number; total: number } | null>(null);
  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [activeClusters, setActiveClusters] = useState<Cluster[]>([]);

  useEffect(() => {
    fetch("/api/wms/combo/warehouse", { headers: authHeaders() })
      .then((r) => r.json())
      .then((json) => {
        const arr: Record<string, unknown>[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
        const pref = arr.find((w) => String(w.code ?? w.id) === "STOO1") ?? arr[0];
        if (pref) setWarehouseCode(String(pref.code ?? pref.id ?? "STOO1"));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const ids = listActiveClusterIds();
    setActiveClusters(ids.map((id) => getCluster(id)).filter(Boolean) as Cluster[]);
  }, []);

  async function load() {
    setLoading(true); setError("");
    const body = { page: 1, limit: 500, pageSize: 500, orderType: "B2C", warehouseCode };
    for (const ep of ["/api/wms/shipping/b2c/list", "/api/wms/shipping/list"]) {
      try {
        const res = await fetch(ep, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) });
        const json = await res.json().catch(() => null);
        const list = json?.data?.list ?? json?.data?.items ?? json?.data ?? json?.list ?? (Array.isArray(json) ? json : []);
        if (res.ok && Array.isArray(list)) { setOrders(list); setLoading(false); return; }
        setError(`HTTP ${res.status}: ${json?.message ?? ep}`);
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [warehouseCode]); // eslint-disable-line

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) { next.delete(code); } else if (next.size < 25) { next.add(code); }
      return next;
    });
  }

  async function startCluster() {
    if (selected.size === 0) return;
    setBuilding(true); setBuildProgress({ done: 0, total: selected.size });

    const bins: ClusterBin[] = [...selected].sort().map((code, i) => {
      const order = orders.find((o) => orderCode(o) === code);
      return { binNo: i + 1, orderCode: code, customerCode: order ? customerCode(order) : "" };
    });

    const id = Date.now().toString();
    const cluster: Cluster = { id, bins, type: "b2c", warehouseCode, createdAt: new Date().toISOString() };
    saveCluster(cluster);

    try {
      const groups = await buildClusterPickList(bins, "b2c", warehouseCode, (done, total) => {
        setBuildProgress({ done, total });
      });
      saveLocationGroups(id, groups);
      router.push(`/outbound/cluster/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build cluster");
      clearCluster(id);
    }
    setBuilding(false);
  }

  const allStatus = useMemo(() => {
    const statusMeta: Record<string, { label: string; color: string }> = {
      CA: { label: "Packing Request", color: "#93c5fd" },
      AA: { label: "Pre-Alert",       color: "#fde047" },
      FA: { label: "Complete",        color: "#86efac" },
    };
    return statusMeta;
  }, []);

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-base font-bold text-white">Cluster Pick</p>
          <p className="text-xs text-slate-400">Select up to 25 B2C orders</p>
        </div>
        <button onClick={load} disabled={loading} className="p-1 text-slate-400 active:text-white">
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="flex-1 px-4 pt-4 pb-32 space-y-4 overflow-y-auto">
        {/* Active clusters */}
        {activeClusters.length > 0 && (
          <div className="rounded-2xl overflow-hidden" style={GLASS}>
            <div className="px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.04)" }}>
              <p className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Active Clusters (Resume)</p>
            </div>
            {activeClusters.map((c) => (
              <button key={c.id} onClick={() => router.push(`/outbound/cluster/${c.id}`)}
                className="w-full px-4 py-3 flex items-center gap-3 active:bg-white/5 text-left"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                <PackageCheck className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white">{c.bins.length} orders</p>
                  <p className="text-xs text-slate-500">{new Date(c.createdAt).toLocaleString()}</p>
                </div>
                <span className="text-slate-500 text-lg">›</span>
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="rounded-2xl p-4 flex items-start gap-3"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300 whitespace-pre-wrap">{error}</p>
          </div>
        )}

        {/* Selection count */}
        {selected.size > 0 && (
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-semibold text-blue-400">{selected.size} / 25 selected</p>
            <button onClick={() => setSelected(new Set())} className="text-xs text-slate-500 active:text-slate-300">Clear</button>
          </div>
        )}

        {/* Order list */}
        {loading && (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
            ))}
          </div>
        )}

        {!loading && orders.length === 0 && !error && (
          <p className="text-center text-slate-500 text-sm py-12">No B2C orders found</p>
        )}

        {!loading && orders.map((o) => {
          const code = orderCode(o);
          const isSelected = selected.has(code);
          const status = String(o.status ?? o.orderStatus ?? o.statusCode ?? "");
          const statusInfo = allStatus[status];
          return (
            <button key={code} onClick={() => toggle(code)}
              className="w-full rounded-2xl p-4 flex items-center gap-3 active:scale-[0.99] transition-all text-left"
              style={{ ...GLASS, ...(isSelected ? { border: "1px solid rgba(59,130,246,0.5)", background: "rgba(59,130,246,0.12)" } : {}) }}>
              <div className="flex-shrink-0">
                {isSelected
                  ? <CheckSquare className="w-5 h-5 text-blue-400" />
                  : <Square className="w-5 h-5 text-slate-600" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-mono text-sm font-bold text-white truncate">{code}</p>
                  {statusInfo && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{ color: statusInfo.color, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      {statusInfo.label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5 truncate">
                  {String(o.customerName ?? o.custName ?? customerCode(o) ?? "")}
                </p>
              </div>
              {isSelected && (
                <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
                  style={{ background: "rgba(59,130,246,0.3)", color: "#93c5fd", border: "1px solid rgba(59,130,246,0.5)" }}>
                  {[...selected].indexOf(code) + 1}
                </div>
              )}
            </button>
          );
        })}
      </main>

      {/* Start button */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4" style={{ background: "linear-gradient(to top, rgba(8,13,26,1) 70%, transparent)" }}>
          <button
            onClick={startCluster}
            disabled={building}
            className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-60"
            style={{ background: "#3b82f6" }}
          >
            {building ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {buildProgress ? `Loading order ${buildProgress.done} / ${buildProgress.total}…` : "Preparing…"}
              </>
            ) : (
              <>
                <PackageCheck className="w-5 h-5" />
                Start Cluster Pick — {selected.size} orders
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
