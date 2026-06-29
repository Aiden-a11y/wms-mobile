"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, RefreshCw, AlertCircle, Loader2, PackageCheck } from "lucide-react";
import { authHeaders } from "@/lib/api";
import {
  buildClusterPickList, saveCluster, saveLocationGroups,
  listActiveClusterIds, getCluster,
  type Cluster,
} from "@/lib/cluster";
import type { B2CCluster } from "@/lib/b2c-cluster";
import { binColor } from "@/lib/b2c-cluster";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };

const MAX_CLUSTER = 25;

interface Order { [k: string]: unknown }
function orderCode(o: Order): string { return String(o.shippingOrderCode ?? o.orderCode ?? o.outboundCode ?? ""); }
function customerCode(o: Order): string { return String(o.customerCode ?? o.custCode ?? ""); }

export default function ClusterPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildProgress, setBuildProgress] = useState<{ done: number; total: number } | null>(null);
  const [warehouseCode, setWarehouseCode] = useState("STOO1");
  const [activeClusters, setActiveClusters] = useState<Cluster[]>([]);
  const [b2cClusters, setB2cClusters] = useState<B2CCluster[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(false);
  const [clusterError, setClusterError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

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

  // Reload local clusters from localStorage
  function reloadLocalClusters() {
    const ids = listActiveClusterIds();
    setActiveClusters(ids.map((id) => getCluster(id)).filter(Boolean) as Cluster[]);
  }

  // Fetch dashboard clusters (active only)
  const loadDashboardClusters = useCallback(async () => {
    setLoadingClusters(true);
    setClusterError("");
    try {
      const res = await fetch("/api/cluster");
      const data = await res.json();
      if (Array.isArray(data)) setB2cClusters(data.filter((c: B2CCluster) => c.status === "active"));
    } catch { setClusterError("Failed to load clusters"); }
    setLastRefresh(new Date());
    setLoadingClusters(false);
  }, []);

  useEffect(() => {
    reloadLocalClusters();
    loadDashboardClusters();
  }, [loadDashboardClusters]);

  // Load orders silently (only for Start Cluster Pick button)
  useEffect(() => {
    const body = { page: 1, limit: 500, pageSize: 500, orderType: "B2C", warehouseCode };
    setLoadingOrders(true);
    const tryNext = (endpoints: string[]) => {
      if (endpoints.length === 0) { setLoadingOrders(false); return; }
      const [ep, ...rest] = endpoints;
      fetch(ep, { method: "POST", headers: authHeaders(), body: JSON.stringify(body) })
        .then((r) => r.json().then((json) => ({ ok: r.ok, json })))
        .then(({ ok, json }) => {
          const list = json?.data?.list ?? json?.data?.items ?? json?.data ?? json?.list ?? (Array.isArray(json) ? json : null);
          if (ok && Array.isArray(list)) { setOrders(list); setLoadingOrders(false); }
          else tryNext(rest);
        })
        .catch(() => tryNext(rest));
    };
    tryNext(["/api/wms/shipping/b2c/list", "/api/wms/shipping/list"]);
  }, [warehouseCode]); // eslint-disable-line

  async function startCluster() {
    if (orders.length === 0) return;
    setBuilding(true); setBuildProgress({ done: 0, total: Math.min(orders.length, MAX_CLUSTER * 2) });
    const candidates = orders.map((o) => ({ orderCode: orderCode(o), customerCode: customerCode(o) }));
    const id = Date.now().toString();
    try {
      const { bins, groups } = await buildClusterPickList(candidates, MAX_CLUSTER, "b2c", warehouseCode, (done, total) => {
        setBuildProgress({ done, total });
      });
      if (bins.length === 0) {
        setClusterError("No orders have picking locations assigned. Allocate locations in WMS first.");
        setBuilding(false);
        return;
      }
      const cluster: Cluster = { id, bins, type: "b2c", warehouseCode, createdAt: new Date().toISOString() };
      saveCluster(cluster);
      saveLocationGroups(id, groups);
      router.push(`/outbound/cluster/${id}`);
    } catch (e) {
      setClusterError(e instanceof Error ? e.message : "Failed to build cluster");
      setBuilding(false);
    }
  }

  const isLoading = loadingClusters || loadingOrders;

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-base font-bold text-white">Cluster Pick</p>
          <p className="text-xs text-slate-400">
            {lastRefresh
              ? `Updated ${lastRefresh.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`
              : "Loading…"}
          </p>
        </div>
        <button onClick={loadDashboardClusters} disabled={loadingClusters} className="p-1 text-slate-400 active:text-white">
          <RefreshCw className={`w-5 h-5 ${loadingClusters ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="flex-1 px-4 pt-4 pb-32 space-y-4 overflow-y-auto">
        {clusterError && (
          <div className="rounded-2xl p-4 flex items-start gap-3"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{clusterError}</p>
          </div>
        )}

        {/* Dashboard B2C Clusters */}
        {loadingClusters ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-16 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
            ))}
          </div>
        ) : b2cClusters.length > 0 ? (
          <div className="rounded-2xl overflow-hidden" style={GLASS}>
            <div className="px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(16,185,129,0.12)" }}>
              <div className="flex items-center gap-2">
                <PackageCheck className="w-3.5 h-3.5 text-emerald-400" />
                <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">B2C Cluster Pick — Dashboard</p>
              </div>
            </div>
            {b2cClusters.map((c) => {
              const colors = c.bins.slice(0, 5).map((b) => binColor(b.binNo));
              return (
                <button key={c.id} onClick={() => router.push(`/outbound/b2ccluster/${encodeURIComponent(c.id)}`)}
                  className="w-full px-4 py-3 flex items-center gap-3 active:bg-white/5 text-left"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <div className="flex gap-0.5 flex-shrink-0">
                    {colors.map((col, i) => (
                      <div key={i} className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-black"
                        style={{ backgroundColor: col.bg, color: col.text }}>
                        {c.bins[i]?.binNo}
                      </div>
                    ))}
                    {c.bins.length > 5 && (
                      <div className="w-4 h-4 rounded flex items-center justify-center text-[8px] font-bold text-slate-400"
                        style={{ background: "rgba(255,255,255,0.1)" }}>
                        +{c.bins.length - 5}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      {c.clusterNo != null && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black bg-indigo-500/30 text-indigo-300 tracking-wide">
                          #{String(c.clusterNo).padStart(4, "0")}
                        </span>
                      )}
                      <p className="text-sm font-semibold text-white">{c.bins.length} bins · {c.locationGroups.length} locations</p>
                    </div>
                    <p className="text-xs text-slate-500">{new Date(c.createdAt).toLocaleString()}</p>
                  </div>
                  <span className="text-slate-500 text-lg flex-shrink-0">›</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl p-6 text-center" style={GLASS}>
            <PackageCheck className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm text-slate-500">No active clusters</p>
            <p className="text-xs text-slate-600 mt-1">Create a cluster from the dashboard</p>
          </div>
        )}

        {/* Active local clusters */}
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
      </main>

      {/* Start Cluster Pick button */}
      <div className="fixed bottom-0 left-0 right-0 p-4"
        style={{ background: "linear-gradient(to top, rgba(8,13,26,1) 70%, transparent)" }}>
        <button
          onClick={startCluster}
          disabled={building || loadingOrders || orders.length === 0}
          className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50"
          style={{ background: "#3b82f6" }}
        >
          {building ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {buildProgress ? `Loading ${buildProgress.done} / ${buildProgress.total}…` : "Preparing…"}
            </>
          ) : loadingOrders ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Loading orders…</>
          ) : (
            <>
              <PackageCheck className="w-5 h-5" />
              Start Cluster Pick{orders.length > 0 ? ` (${orders.length})` : ""}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
