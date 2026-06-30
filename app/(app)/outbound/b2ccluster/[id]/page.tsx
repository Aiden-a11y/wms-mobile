"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, CheckCircle2, Loader2, MapPin } from "lucide-react";
import type { B2CCluster } from "@/lib/b2c-cluster";
import { binColor } from "@/lib/b2c-cluster";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };

function doneKey(id: string) { return `b2ccluster_done_${id}`; }

export function getDoneSet(id: string): Set<number> {
  try {
    const raw = localStorage.getItem(doneKey(id));
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as number[]);
  } catch { return new Set(); }
}

export function markLocationDone(id: string, locIdx: number) {
  const s = getDoneSet(id);
  s.add(locIdx);
  localStorage.setItem(doneKey(id), JSON.stringify(Array.from(s)));
}

export default function B2CClusterOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [cluster, setCluster] = useState<B2CCluster | null>(null);
  const [loading, setLoading] = useState(true);
  const [doneSet, setDoneSet] = useState<Set<number>>(new Set());
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    fetch(`/api/cluster?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => { if (data) setCluster(data as B2CCluster); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    setDoneSet(getDoneSet(id));
  }, [id]);

  const nextLocIdx = cluster
    ? cluster.locationGroups.findIndex((_, i) => !doneSet.has(i))
    : -1;
  const allDone = cluster ? nextLocIdx === -1 && cluster.locationGroups.length > 0 : false;
  const donePct = cluster && cluster.locationGroups.length > 0
    ? Math.round((doneSet.size / cluster.locationGroups.length) * 100)
    : 0;

  async function closeCluster() {
    if (closing) return;
    setClosing(true);
    const { authHeaders } = await import("@/lib/api");
    const res = await fetch(`/api/cluster/close?id=${encodeURIComponent(id)}`, {
      method: "POST",
      headers: authHeaders(),
    });
    if (res.ok) localStorage.removeItem(`b2ccluster_done_${id}`);
    router.replace("/outbound/cluster");
  }

  // Auto-complete the moment picking finishes — no manual "Complete" action exists
  // anywhere in the app. /api/cluster/close is itself idempotent (skips if already
  // completed), so this effect re-running on remount/re-render is harmless.
  useEffect(() => {
    if (allDone && !closing) closeCluster();
  }, [allDone]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={DARK}>
      <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
    </div>
  );

  if (!cluster) return (
    <div className="min-h-screen flex items-center justify-center" style={DARK}>
      <p className="text-slate-400">Cluster not found</p>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-base font-bold text-white">Cluster Pick</p>
            {cluster.clusterNo != null && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-black bg-indigo-500/30 text-indigo-300 tracking-wide">
                #{String(cluster.clusterNo).padStart(4, "0")}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400">{cluster.bins.length} bins · {cluster.locationGroups.length} locations · {cluster.warehouseCode}</p>
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 pb-32 space-y-4 overflow-y-auto">
        {/* Progress */}
        <div className="rounded-2xl p-4" style={GLASS}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-slate-400">Progress</p>
            <p className="text-xs font-bold text-white">{doneSet.size} / {cluster.locationGroups.length} locations</p>
          </div>
          <div className="h-2 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }}>
            <div className="h-2 rounded-full transition-all" style={{ width: `${donePct}%`, background: allDone ? "#10b981" : "#3b82f6" }} />
          </div>
          {allDone && (
            <p className="text-xs text-emerald-400 font-semibold mt-2 text-center">All locations complete!</p>
          )}
        </div>

        {/* Bin grid */}
        <div className="rounded-2xl p-4" style={GLASS}>
          <p className="text-xs font-semibold text-slate-400 mb-3">Cart Bins</p>
          <div className="grid grid-cols-5 gap-2">
            {cluster.bins.map((bin) => {
              const c = binColor(bin.binNo);
              return (
                <div key={bin.binNo}
                  className="aspect-square rounded-xl flex flex-col items-center justify-center"
                  style={{ backgroundColor: c.bg }}>
                  <span className="text-base font-black" style={{ color: c.text }}>{bin.binNo}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Location list */}
        <div className="rounded-2xl overflow-hidden" style={GLASS}>
          <div className="px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
            <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Pick Route</p>
          </div>
          {cluster.locationGroups.map((grp, idx) => {
            const done = doneSet.has(idx);
            const isCurrent = idx === nextLocIdx;
            return (
              <button
                key={grp.locationCode}
                onClick={() => !done && router.push(`/outbound/b2ccluster/${encodeURIComponent(id)}/pick/${idx}`)}
                className="w-full px-4 py-3 flex items-center gap-3 active:bg-white/5 text-left"
                style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                disabled={done}
              >
                {done
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  : <MapPin className={`w-5 h-5 flex-shrink-0 ${isCurrent ? "text-blue-400" : "text-slate-500"}`} />
                }
                <div className="flex-1 min-w-0">
                  <p className={`font-mono text-sm font-bold ${done ? "text-slate-600" : isCurrent ? "text-white" : "text-slate-300"}`}>
                    {grp.locationCode}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {grp.tasks.map((t, ti) => {
                      const c = binColor(t.binNo);
                      return (
                        <span key={ti} className="text-xs px-1.5 py-0.5 rounded font-bold"
                          style={{ backgroundColor: `${c.bg}30`, color: c.bg }}>
                          {t.binNo}
                        </span>
                      );
                    })}
                    <span className="text-xs text-slate-500 ml-1">{grp.tasks.length} pick{grp.tasks.length !== 1 ? "s" : ""}</span>
                  </div>
                </div>
                {!done && <span className="text-slate-500 text-xl flex-shrink-0">›</span>}
              </button>
            );
          })}
        </div>
      </main>

      {/* Bottom CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-4"
        style={{ background: "linear-gradient(to top, rgba(8,13,26,1) 70%, transparent)" }}>
        {allDone ? (
          <div className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2"
            style={{ background: "#10b981" }}>
            <Loader2 className="w-5 h-5 animate-spin" /> Completing…
          </div>
        ) : (
          <button
            onClick={() => nextLocIdx >= 0 && router.push(`/outbound/b2ccluster/${encodeURIComponent(id)}/pick/${nextLocIdx}`)}
            className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
            style={{ background: "#3b82f6" }}>
            <MapPin className="w-5 h-5" />
            Start Picking → Location {nextLocIdx + 1}
          </button>
        )}
      </div>
    </div>
  );
}
