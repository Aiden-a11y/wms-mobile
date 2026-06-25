"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, CheckCircle2, Loader2, AlertCircle, ScanLine, Package } from "lucide-react";
import type { B2CCluster, B2CClusterLocationGroup, B2CClusterTask } from "@/lib/b2c-cluster";
import { binColor } from "@/lib/b2c-cluster";
import { authHeaders } from "@/lib/api";
import { markLocationDone, getDoneSet } from "../../page";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };

type Step = "scan_loc" | "scan_sku" | "confirm" | "done";

function normalizeCode(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

async function confirmPick(
  orderCode: string, task: B2CClusterTask, locationCode: string
): Promise<{ ok: boolean; message?: string }> {
  const payload = {
    shippingOrderCode: orderCode,
    orderCode,
    shippingItemId: task.shippingItemId || undefined,
    pickingId: task.shippingItemId || undefined,
    locationCode,
    locationId: task.locationId || undefined,
    inKey: task.locationId || undefined,
    productSku: task.sku,
    qty: task.qty,
    pickedQty: task.qty,
    unit: "EA",
    lotNo: task.lotNo || undefined,
    expireDate: task.expireDate || undefined,
    itemCondition: task.itemCondition || undefined,
  };
  const endpoints = [
    "/api/wms/shipping/b2c/pick",
    "/api/wms/shipping/pick",
    "/api/wms/outbound/b2c/pick",
    "/api/wms/outbound/pick",
    "/api/wms/shipping/picking/confirm",
    "/api/wms/outbound/picking/confirm",
  ];
  const hdr = { ...authHeaders(), "Content-Type": "application/json" };
  let allNotFound = true;
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, { method: "POST", headers: hdr, body: JSON.stringify(payload) });
      if (res.status === 404 || res.status === 405) continue;
      allNotFound = false;
      const j = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (res.ok && (j?.isSuccess !== false)) return { ok: true };
      return { ok: false, message: String(j?.message ?? j?.msg ?? "Pick failed") };
    } catch { /* try next */ }
  }
  if (allNotFound) return { ok: true, message: "no-confirm-api" };
  return { ok: false, message: "All endpoints failed" };
}

export default function B2CClusterPickPage() {
  const { id, locIdx: locIdxStr } = useParams<{ id: string; locIdx: string }>();
  const locIdx = parseInt(locIdxStr);
  const router = useRouter();

  const [cluster, setCluster] = useState<B2CCluster | null>(null);
  const [loading, setLoading] = useState(true);

  const [step, setStep] = useState<Step>("scan_loc");
  const [taskIdx, setTaskIdx] = useState(0);
  const [locInput, setLocInput] = useState("");
  const [skuInput, setSkuInput] = useState("");
  const [locError, setLocError] = useState("");
  const [skuError, setSkuError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");
  const [completedTasks, setCompletedTasks] = useState<B2CClusterTask[]>([]);

  const locRef = useRef<HTMLInputElement>(null);
  const skuRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/cluster?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((data) => { if (data) setCluster(data as B2CCluster); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [id]);

  const grp: B2CClusterLocationGroup | undefined = cluster?.locationGroups[locIdx];
  const currentTask: B2CClusterTask | undefined = grp?.tasks[taskIdx];

  // Auto-focus inputs
  useEffect(() => {
    if (step === "scan_loc") setTimeout(() => locRef.current?.focus(), 100);
    if (step === "scan_sku") setTimeout(() => skuRef.current?.focus(), 100);
  }, [step]);

  const handleLocScan = useCallback(async () => {
    if (!grp || !locInput.trim()) return;
    const input = normalizeCode(locInput);
    const expected = normalizeCode(grp.locationCode);

    if (input === expected || expected.includes(input) || input.includes(expected)) {
      setLocError("");
      setLocInput("");
      setStep("scan_sku");
      return;
    }

    // Try API validation
    try {
      const res = await fetch("/api/wms/warehouse/location-search", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ search: locInput.trim(), warehouseCode: cluster?.warehouseCode ?? "" }),
      });
      const j = await res.json().catch(() => ({})) as Record<string, unknown>;
      const loc = (Array.isArray(j?.data) ? j.data[0] : j?.data ?? j) as Record<string, unknown> | null;
      if (loc) {
        const apiCode = normalizeCode(String(loc.locationCode ?? loc.code ?? ""));
        if (apiCode === expected || expected.includes(apiCode) || apiCode.includes(expected)) {
          setLocError("");
          setLocInput("");
          setStep("scan_sku");
          return;
        }
      }
    } catch { /* ignore */ }

    setLocError(`Expected: ${grp.locationCode}`);
    setLocInput("");
  }, [locInput, grp, cluster]);

  const handleSkuScan = useCallback(() => {
    if (!currentTask || !skuInput.trim()) return;
    const input = normalizeCode(skuInput);
    const expected = normalizeCode(currentTask.sku);
    if (input === expected) {
      setSkuError("");
      setSkuInput("");
      setStep("confirm");
    } else {
      setSkuError(`Expected: ${currentTask.sku}`);
      setSkuInput("");
    }
  }, [skuInput, currentTask]);

  async function handleDone() {
    if (!currentTask || !grp) return;
    setConfirming(true);
    setConfirmError("");
    const result = await confirmPick(currentTask.orderCode, currentTask, grp.locationCode);
    setConfirming(false);

    if (!result.ok) {
      setConfirmError(result.message ?? "Pick confirmation failed");
      return;
    }

    setCompletedTasks((p) => [...p, currentTask]);
    const nextIdx = taskIdx + 1;

    if (nextIdx < grp.tasks.length) {
      // More tasks at this location — go back to scan_loc (user re-scans location)
      setTaskIdx(nextIdx);
      setStep("scan_loc");
      setLocInput("");
      setSkuInput("");
      setLocError("");
      setSkuError("");
    } else {
      // All tasks at this location done
      markLocationDone(id, locIdx);
      setStep("done");
    }
  }

  function goNext() {
    if (!cluster) return;
    const doneSet = getDoneSet(id);
    const nextLoc = cluster.locationGroups.findIndex((_, i) => i > locIdx && !doneSet.has(i));
    if (nextLoc >= 0) {
      router.replace(`/outbound/b2ccluster/${encodeURIComponent(id)}/pick/${nextLoc}`);
    } else {
      router.replace(`/outbound/b2ccluster/${encodeURIComponent(id)}`);
    }
  }

  if (loading || !cluster || !grp) return (
    <div className="min-h-screen flex items-center justify-center" style={DARK}>
      <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
    </div>
  );

  const taskColor = currentTask ? binColor(currentTask.binNo) : { bg: "#3b82f6", text: "#fff" };
  const totalLocs = cluster.locationGroups.length;

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.push(`/outbound/b2ccluster/${encodeURIComponent(id)}`)}
          className="p-1 text-slate-400 active:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-base font-bold text-white">Location {locIdx + 1} / {totalLocs}</p>
          <p className="font-mono text-xs text-blue-400">{grp.locationCode}</p>
        </div>
        <span className="text-xs text-slate-500">{grp.tasks.length} pick{grp.tasks.length !== 1 ? "s" : ""}</span>
      </header>

      <main className="flex-1 px-4 pt-4 pb-6 flex flex-col gap-4 overflow-y-auto">
        {/* Task progress dots */}
        <div className="flex justify-center gap-2">
          {grp.tasks.map((t, i) => {
            const c = binColor(t.binNo);
            const isDone = i < taskIdx || step === "done";
            const isCurr = i === taskIdx && step !== "done";
            return (
              <div key={i}
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all"
                style={{
                  backgroundColor: isDone ? c.bg : isCurr ? c.bg : "transparent",
                  borderColor: c.bg,
                  color: isDone || isCurr ? c.text : c.bg,
                  opacity: isDone ? 0.5 : 1,
                }}>
                {isDone ? "✓" : t.binNo}
              </div>
            );
          })}
        </div>

        {/* ── Wrong location error banner ── */}
        {locError && step === "scan_loc" && (
          <div className="rounded-2xl p-4 flex items-start gap-3 animate-pulse"
            style={{ background: "rgba(239,68,68,0.2)", border: "2px solid rgba(239,68,68,0.6)" }}>
            <AlertCircle className="w-6 h-6 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-black text-red-300">Wrong Location!</p>
              <p className="text-xs text-red-400 mt-0.5">{locError}</p>
            </div>
          </div>
        )}

        {/* ── scan_loc ── */}
        {step === "scan_loc" && (
          <div className="rounded-2xl p-5 space-y-4"
            style={{
              background: locError ? "rgba(239,68,68,0.08)" : "rgba(59,130,246,0.12)",
              border: locError ? "1px solid rgba(239,68,68,0.4)" : "1px solid rgba(59,130,246,0.3)",
            }}>
            <div className="flex items-center gap-2">
              <ScanLine className="w-5 h-5" style={{ color: locError ? "#f87171" : "#60a5fa" }} />
              <p className="text-sm font-bold" style={{ color: locError ? "#fca5a5" : "#93c5fd" }}>
                Scan Location Barcode
              </p>
            </div>
            <p className="font-mono text-lg font-black text-white">{grp.locationCode}</p>
            {currentTask && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-slate-400">Next: </span>
                <span className="w-6 h-6 rounded flex items-center justify-center text-xs font-bold"
                  style={{ backgroundColor: taskColor.bg, color: taskColor.text }}>
                  {currentTask.binNo}
                </span>
                <span className="text-xs text-slate-300 font-mono">{currentTask.sku}</span>
                <span className="text-xs text-slate-400">×{currentTask.qty}</span>
              </div>
            )}
            <input
              ref={locRef}
              value={locInput}
              onChange={(e) => { setLocInput(e.target.value); setLocError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleLocScan()}
              placeholder="Scan or type location code…"
              className="w-full bg-white/10 rounded-xl px-4 py-3 text-white text-sm font-mono placeholder:text-slate-500 focus:outline-none"
              style={{ border: locError ? "2px solid rgba(239,68,68,0.6)" : "1px solid rgba(255,255,255,0.2)" }}
              autoComplete="off" autoCorrect="off" spellCheck={false}
            />
            <button onClick={handleLocScan} disabled={!locInput.trim()}
              className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 active:scale-[0.98] transition-all"
              style={{ background: locError ? "#dc2626" : "#3b82f6" }}>
              Confirm Location
            </button>
          </div>
        )}

        {/* ── scan_sku ── */}
        {step === "scan_sku" && currentTask && (
          <div className="rounded-2xl p-5 space-y-4" style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.3)" }}>
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-violet-400" />
              <p className="text-sm font-bold text-violet-300">Scan Product Barcode</p>
            </div>

            {/* Bin target */}
            <div className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(0,0,0,0.3)" }}>
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black flex-shrink-0"
                style={{ backgroundColor: taskColor.bg, color: taskColor.text }}>
                {currentTask.binNo}
              </div>
              <div>
                <p className="font-mono text-sm font-bold text-white">{currentTask.sku}</p>
                {currentTask.skuName && <p className="text-xs text-slate-400 mt-0.5">{currentTask.skuName}</p>}
                <p className="text-sm font-bold text-blue-300 mt-1">×{currentTask.qty} EA</p>
              </div>
            </div>

            <input
              ref={skuRef}
              value={skuInput}
              onChange={(e) => setSkuInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSkuScan()}
              placeholder="Scan or type SKU / barcode…"
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-sm font-mono placeholder:text-slate-500 focus:outline-none focus:border-violet-400"
              autoComplete="off" autoCorrect="off" spellCheck={false}
            />
            {skuError && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {skuError}
              </div>
            )}
            <button onClick={handleSkuScan} disabled={!skuInput.trim()}
              className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40 active:scale-[0.98] transition-all"
              style={{ background: "#8b5cf6" }}>
              Confirm Product
            </button>
          </div>
        )}

        {/* ── confirm (put in bin) ── */}
        {step === "confirm" && currentTask && (
          <div className="rounded-2xl p-5 space-y-4 flex flex-col items-center text-center">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Place in Cart Bin</p>

            <div className="w-36 h-36 rounded-3xl flex items-center justify-center text-6xl font-black shadow-2xl"
              style={{ backgroundColor: taskColor.bg, color: taskColor.text, boxShadow: `0 0 40px ${taskColor.bg}60` }}>
              {currentTask.binNo}
            </div>

            <div>
              <p className="font-mono text-lg font-black text-white">{currentTask.sku}</p>
              {currentTask.skuName && <p className="text-sm text-slate-400 mt-1">{currentTask.skuName}</p>}
              <p className="text-3xl font-black text-blue-300 mt-2">×{currentTask.qty} EA</p>
              <p className="text-xs text-slate-500 mt-1">Order: {currentTask.orderCode}</p>
            </div>

            {confirmError && (
              <div className="flex items-start gap-2 text-red-400 text-sm bg-red-900/20 rounded-xl p-3 w-full text-left">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {confirmError}
              </div>
            )}

            <button onClick={handleDone} disabled={confirming}
              className="w-full py-4 rounded-2xl text-base font-black text-white disabled:opacity-50 active:scale-[0.98] transition-all"
              style={{ background: "#10b981" }}>
              {confirming ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : "Done ✓"}
            </button>
          </div>
        )}

        {/* ── done ── */}
        {step === "done" && (
          <div className="rounded-2xl p-5 space-y-4">
            <div className="flex flex-col items-center text-center mb-2">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 mb-2" />
              <p className="text-base font-black text-white">Location Complete!</p>
              <p className="font-mono text-sm text-emerald-400">{grp.locationCode}</p>
            </div>

            {/* Summary of picks done */}
            <div className="space-y-2">
              {completedTasks.map((t, i) => {
                const c = binColor(t.binNo);
                return (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black flex-shrink-0"
                      style={{ backgroundColor: c.bg, color: c.text }}>
                      {t.binNo}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm font-bold text-white">{t.sku}</p>
                      {t.skuName && <p className="text-xs text-slate-400">{t.skuName}</p>}
                    </div>
                    <span className="text-sm font-bold text-emerald-400">×{t.qty}</span>
                  </div>
                );
              })}
            </div>

            <button onClick={goNext}
              className="w-full py-4 rounded-2xl text-sm font-black text-white active:scale-[0.98] transition-all"
              style={{ background: "#3b82f6" }}>
              Next Location →
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
