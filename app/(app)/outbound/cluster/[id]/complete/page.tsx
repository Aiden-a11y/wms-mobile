"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { CheckCircle2, PackageCheck, Loader2 } from "lucide-react";
import { getCluster, getLocationGroups, clearCluster } from "@/lib/cluster";
import { wmsPost } from "@/lib/api";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const GLASS = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };

export default function ClusterCompletePage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [cleared, setCleared] = useState(false);
  const [statusDone, setStatusDone] = useState(false);

  const cluster = getCluster(id);
  const groups = getLocationGroups(id) ?? [];
  const totalItems = groups.reduce((s, g) => s + g.tasks.reduce((a, t) => a + t.allocatedQty, 0), 0);

  useEffect(() => {
    if (cleared || !cluster) return;

    // Group bins by customerCode, then call status-change → CA for each group
    const grouped = new Map<string, string[]>();
    for (const bin of cluster.bins) {
      if (!grouped.has(bin.customerCode)) grouped.set(bin.customerCode, []);
      grouped.get(bin.customerCode)!.push(bin.orderCode);
    }
    Promise.all(
      Array.from(grouped.entries()).map(([customerCode, orderCodes]) =>
        wmsPost("shipping/status-change", {
          warehouseCode: cluster.warehouseCode,
          customerCode,
          orderCodes,
          newStatus: "CA",
          completeDate: "",
          cancelComment: "",
        }).catch(() => {})
      )
    ).finally(() => setStatusDone(true));

    clearCluster(id);
    setCleared(true);
  }, [id]); // eslint-disable-line

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6" style={DARK}>
      <div className="w-24 h-24 rounded-full flex items-center justify-center"
        style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)" }}>
        <PackageCheck className="w-12 h-12 text-green-400" />
      </div>

      <div className="text-center">
        <p className="text-2xl font-bold text-white mb-1">Cluster Complete!</p>
        <p className="text-sm text-slate-400">All locations picked successfully</p>
      </div>

      <div className="w-full rounded-2xl p-5 space-y-3" style={GLASS}>
        {[
          ["Orders", String(cluster?.bins.length ?? "–")],
          ["Locations", String(groups.length)],
          ["Total Items", String(totalItems)],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between text-sm">
            <span className="text-slate-400">{k}</span>
            <span className="font-mono font-bold text-white">{v}</span>
          </div>
        ))}
      </div>

      {cluster && (
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

      <button onClick={() => router.replace("/outbound")}
        disabled={!statusDone}
        className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
        style={{ background: "#3b82f6" }}>
        {statusDone ? "Back to Outbound" : <><Loader2 className="w-4 h-4 animate-spin" /> Updating status…</>}
      </button>
    </div>
  );
}
