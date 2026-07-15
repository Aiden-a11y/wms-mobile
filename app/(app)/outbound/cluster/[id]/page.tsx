"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { ChevronLeft, MapPin, CheckCircle2, Circle, PackageCheck } from "lucide-react";
import { getCluster, getLocationGroups, getDoneSet, setPickedBy, binColor, type LocationGroup } from "@/lib/cluster";
import { getAuth } from "@/lib/auth";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };

function locLabel(g: LocationGroup) {
  return [g.zoneName, g.aisleName, g.bayName, g.levelName, g.positionName].filter(Boolean).join(" - ") || g.locationCode;
}

export default function ClusterOverviewPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const cluster = getCluster(id);
  const groups = getLocationGroups(id) ?? [];
  const [doneSet, setDoneSet] = useState<Set<number>>(new Set());

  useEffect(() => {
    setDoneSet(getDoneSet(id));
    const user = getAuth();
    const name = user?.name ?? user?.userId ?? "";
    if (name) setPickedBy(id, name);
  }, [id]);

  if (!cluster) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={DARK}>
        <p className="text-red-400">Cluster not found</p>
        <button onClick={() => router.replace("/outbound/cluster")} className="text-blue-400 text-sm">← Back</button>
      </div>
    );
  }

  const doneCount = doneSet.size;
  const totalCount = groups.length;
  const firstPending = groups.findIndex((_, i) => !doneSet.has(i));

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-base font-bold text-white">Cluster Pick</p>
          <p className="text-xs text-slate-400">{cluster.bins.length} orders · {totalCount} locations</p>
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 pb-28 space-y-4 overflow-y-auto">
        {/* Progress */}
        <div className="rounded-2xl p-4" style={GLASS}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Progress</p>
            <p className="text-sm font-bold text-white">{doneCount} / {totalCount}</p>
          </div>
          <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${totalCount ? (doneCount / totalCount) * 100 : 0}%`, background: "#3b82f6" }} />
          </div>
        </div>

        {/* Bin grid */}
        <div className="rounded-2xl p-4" style={GLASS}>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Bins</p>
          <div className="grid grid-cols-5 gap-1.5">
            {cluster.bins.map((bin) => {
              const c = binColor(bin.binNo);
              return (
                <div key={bin.binNo} className="rounded-lg p-1.5 text-center"
                  style={{ background: c.bg, border: `1px solid ${c.border}` }}>
                  <p className="text-xs font-bold" style={{ color: c.text }}>{bin.binNo}</p>
                  <p className="text-[9px] text-slate-500 truncate mt-0.5">{bin.orderCode.slice(-6)}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Location list */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1 mb-2">Locations</p>
          <div className="space-y-1.5">
            {groups.map((g, i) => {
              const done = doneSet.has(i);
              return (
                <button key={i} onClick={() => !done && router.push(`/outbound/cluster/${id}/pick/${i}`)}
                  className="w-full rounded-xl px-4 py-3 flex items-center gap-3 text-left active:scale-[0.99] transition-all"
                  style={{ ...GLASS, ...(done ? { opacity: 0.5 } : {}) }}>
                  {done
                    ? <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                    : <Circle className="w-4 h-4 text-slate-600 flex-shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono font-semibold text-white truncate">{locLabel(g)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{g.tasks.length} task{g.tasks.length !== 1 ? "s" : ""}</p>
                  </div>
                  {!done && <MapPin className="w-4 h-4 text-slate-600 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </main>

      {/* Start / Continue button */}
      <div className="fixed bottom-0 left-0 right-0 p-4"
        style={{ background: "linear-gradient(to top, rgba(8,13,26,1) 70%, transparent)" }}>
        {doneCount === totalCount && totalCount > 0 ? (
          <button onClick={() => router.push(`/outbound/cluster/${id}/complete`)}
            className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98]"
            style={{ background: "#16a34a" }}>
            <PackageCheck className="w-5 h-5" /> All Done — Complete
          </button>
        ) : (
          <button
            onClick={() => firstPending >= 0 && router.push(`/outbound/cluster/${id}/pick/${firstPending}`)}
            disabled={firstPending < 0}
            className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50"
            style={{ background: "#3b82f6" }}>
            <MapPin className="w-5 h-5" />
            {doneCount === 0 ? "Start Picking" : `Continue — Location ${doneCount + 1}`}
          </button>
        )}
      </div>
    </div>
  );
}
