"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { CheckCircle2, PackageCheck, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { getCluster, getLocationGroups, clearCluster, type Cluster } from "@/lib/cluster";
import { wmsPost } from "@/lib/api";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const GLASS = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };

export default function ClusterCompletePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  // Capture cluster data at mount into a ref — stays available for retry even after clearCluster
  const clusterRef = useRef<Cluster | null>(getCluster(id));
  const cluster = clusterRef.current;
  const groups = getLocationGroups(id) ?? [];
  const totalItems = groups.reduce((s, g) => s + g.tasks.reduce((a, t) => a + t.allocatedQty, 0), 0);

  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const ran = useRef(false);

  async function runStatusChange() {
    if (!cluster) { setStatus("done"); return; }
    setStatus("loading"); setErrorMsg("");

    const grouped = new Map<string, string[]>();
    for (const bin of cluster.bins) {
      if (!grouped.has(bin.customerCode)) grouped.set(bin.customerCode, []);
      grouped.get(bin.customerCode)!.push(bin.orderCode);
    }

    const errors: string[] = [];
    await Promise.all(
      Array.from(grouped.entries()).map(async ([customerCode, orderCodes]) => {
        try {
          await wmsPost("shipping/status-change", {
            warehouseCode: cluster.warehouseCode,
            customerCode,
            orderCodes,
            newStatus: "CA",
            completeDate: "",
            cancelComment: "",
          });
        } catch (e) {
          errors.push(`${customerCode}: ${e instanceof Error ? e.message : "error"}`);
        }
      })
    );

    if (errors.length > 0) {
      setErrorMsg(errors.join("; "));
      setStatus("error");
      // Do NOT clear cluster here — keep data so user can retry
    } else {
      clearCluster(id); // Only clear after confirmed success
      setStatus("done");
    }
  }

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    runStatusChange();
  }, []); // eslint-disable-line

  const isError = status === "error";
  const isLoading = status === "loading";

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6" style={DARK}>
      <div className="w-24 h-24 rounded-full flex items-center justify-center"
        style={{
          background: isError ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
          border: `1px solid ${isError ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
        }}>
        {isError
          ? <AlertCircle className="w-12 h-12 text-red-400" />
          : <PackageCheck className="w-12 h-12 text-green-400" />}
      </div>

      <div className="text-center">
        <p className="text-2xl font-bold text-white mb-1">
          {isError ? "Status Update Failed" : "Cluster Complete!"}
        </p>
        <p className="text-sm text-slate-400">
          {isLoading
            ? "Updating order status to CA…"
            : isError
              ? "Picking done, but WMS status could not be updated."
              : "All locations picked — status updated to CA"}
        </p>
      </div>

      {isError && errorMsg && (
        <div className="w-full rounded-2xl p-4"
          style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)" }}>
          <p className="text-xs text-red-300 font-mono break-all">{errorMsg}</p>
        </div>
      )}

      <div className="w-full rounded-2xl p-5 space-y-3" style={GLASS}>
        {[
          ["Orders",      String(cluster?.bins.length ?? "–")],
          ["Locations",   String(groups.length)],
          ["Total Items", String(totalItems)],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-slate-400">{k}</span>
            <span className="font-mono font-bold text-white">{v}</span>
          </div>
        ))}
      </div>

      {cluster && !isLoading && (
        <div className="w-full rounded-2xl p-4" style={GLASS}>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Orders in Cluster</p>
          <div className="space-y-1">
            {cluster.bins.map((bin) => (
              <div key={bin.binNo} className="flex items-center gap-3">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                <span className="text-xs text-slate-400">Bin {bin.binNo}</span>
                <span className="font-mono text-xs text-white flex-1 truncate">{bin.orderCode}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isError && (
        <button onClick={runStatusChange}
          className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98]"
          style={{ background: "#dc2626" }}>
          <RefreshCw className="w-4 h-4" /> Retry Status Update
        </button>
      )}

      <button
        onClick={() => {
          if (isError) clearCluster(id); // Force-clear on skip so it doesn't linger
          router.replace("/outbound");
        }}
        disabled={isLoading}
        className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
        style={{ background: isLoading ? "#1e293b" : isError ? "#4b5563" : "#3b82f6" }}>
        {isLoading
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Updating status…</>
          : isError ? "Skip → Back to Outbound"
          : "Back to Outbound"}
      </button>
    </div>
  );
}
