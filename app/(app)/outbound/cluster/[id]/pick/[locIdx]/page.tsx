"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ChevronLeft, MapPin, ScanLine, AlertCircle,
  CheckCircle2, Loader2, Package,
} from "lucide-react";
import { authHeaders } from "@/lib/api";
import {
  getCluster, getLocationGroups, getDoneSet, markLocationDone,
  confirmPick, binColor, type LocationGroup, type ClusterPickTask,
} from "@/lib/cluster";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };
const INPUT_STYLE = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(59,130,246,0.5)" };

type Step = "location" | "sku" | "qty" | "bin" | "location_done";

function normalize(s: string) {
  return s.toLowerCase().replace(/[\s\-_/]+/g, "");
}

function locLabel(g: LocationGroup) {
  return [g.zoneName, g.aisleName, g.bayName, g.levelName, g.positionName].filter(Boolean).join(" - ") || g.locationCode;
}

function ClusterPickInner() {
  const router = useRouter();
  const { id, locIdx: locIdxStr } = useParams<{ id: string; locIdx: string }>();
  const locIdx = parseInt(locIdxStr, 10);

  const cluster = getCluster(id);
  const groups = getLocationGroups(id) ?? [];
  const group: LocationGroup | undefined = groups[locIdx];

  const [step, setStep] = useState<Step>("location");
  const [taskIdx, setTaskIdx] = useState(0);
  const [confirmedTasks, setConfirmedTasks] = useState<ClusterPickTask[]>([]);

  const [locScan, setLocScan] = useState("");
  const [locError, setLocError] = useState("");
  const [locLoading, setLocLoading] = useState(false);

  const [skuScan, setSkuScan] = useState("");
  const [skuError, setSkuError] = useState("");

  const [qty, setQty] = useState(0);

  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  const locRef = useRef<HTMLInputElement>(null);
  const skuRef = useRef<HTMLInputElement>(null);

  const currentTask: ClusterPickTask | undefined = group?.tasks[taskIdx];

  useEffect(() => {
    if (step === "location") setTimeout(() => locRef.current?.focus(), 100);
    if (step === "sku") { setSkuScan(""); setSkuError(""); setTimeout(() => skuRef.current?.focus(), 100); }
    if (step === "qty") setQty(currentTask?.allocatedQty ?? 0);
  }, [step, taskIdx]); // eslint-disable-line

  if (!cluster || !group) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={DARK}>
        <p className="text-red-400">Location not found</p>
        <button onClick={() => router.replace(`/outbound/cluster/${id}`)} className="text-blue-400 text-sm">← Back</button>
      </div>
    );
  }

  // After the early return guard above, cluster and group are always defined
  const g = group!;
  const cl = cluster!;

  // ── Location scan ────────────────────────────────────────────────────────────
  async function handleLocationScan() {
    const raw = locScan.trim();
    if (!raw) return;
    setLocLoading(true); setLocError("");

    // Normalize and compare
    const expected = normalize(g.locationCode);
    const scanned  = normalize(raw);
    if (scanned === expected || expected.includes(scanned) || scanned.includes(expected)) {
      setLocScan(""); setLocLoading(false); setStep("sku");
      return;
    }

    // Try API lookup to confirm location
    try {
      const wc = cl.warehouseCode || "STOO1";
      const res = await fetch("/api/wms/warehouse/location-search", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ search: raw, warehouseCode: wc }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        const d = (Array.isArray(json?.data) ? json.data[0] : json?.data) as Record<string, unknown> | null;
        if (d) {
          const scannedCode = String(d.locationCode ?? raw);
          if (normalize(scannedCode) === expected || normalize(scannedCode).includes(normalize(g.aisleName + g.bayName))) {
            setLocScan(""); setLocLoading(false); setStep("sku");
            return;
          }
        }
      }
    } catch { /* ignore */ }

    setLocError(`Wrong location. Expected: ${locLabel(g)}`);
    setLocLoading(false);
  }

  // ── SKU scan ────────────────────────────────────────────────────────────────
  function handleSkuScan() {
    const raw = skuScan.trim();
    if (!raw || !currentTask) return;
    if (raw.toLowerCase() === currentTask.sku.toLowerCase() || raw === currentTask.sku) {
      setSkuScan(""); setSkuError(""); setStep("qty");
    } else {
      setSkuError(`Expected: ${currentTask.sku}`);
    }
  }

  // ── Bin confirm ──────────────────────────────────────────────────────────────
  async function handleBinConfirm() {
    if (!currentTask) return;
    setConfirming(true); setConfirmError("");
    const result = await confirmPick(currentTask.orderCode, cl.type, currentTask, qty, "EA");
    if (!result.ok) {
      setConfirmError(result.message ?? "Confirm failed");
      setConfirming(false);
      return;
    }
    setConfirmedTasks((prev) => [...prev, { ...currentTask, pickedQty: qty }]);
    setConfirming(false);

    const nextIdx = taskIdx + 1;
    if (nextIdx < g.tasks.length) {
      setTaskIdx(nextIdx);
      setStep("sku");
    } else {
      setStep("location_done");
    }
  }

  // ── Done: mark location complete and navigate ────────────────────────────────
  function handleNext() {
    markLocationDone(id, locIdx);
    const doneSet = getDoneSet(id);
    const nextLoc = groups.findIndex((_, i) => i > locIdx && !doneSet.has(i));
    if (nextLoc >= 0) {
      router.replace(`/outbound/cluster/${id}/pick/${nextLoc}`);
    } else {
      router.replace(`/outbound/cluster/${id}/complete`);
    }
  }

  const binC = currentTask ? binColor(currentTask.binNo) : binColor(1);

  // ── Step: LOCATION DONE ──────────────────────────────────────────────────────
  if (step === "location_done") {
    return (
      <div className="min-h-screen flex flex-col" style={DARK}>
        <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
          <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <p className="text-base font-bold text-white">Location Done</p>
        </header>
        <main className="flex-1 px-4 pt-4 pb-8 space-y-4 overflow-y-auto">
          <div className="rounded-2xl p-4" style={{ ...GLASS, border: "1px solid rgba(34,197,94,0.3)", background: "rgba(34,197,94,0.08)" }}>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <p className="text-xs font-semibold text-green-300 uppercase tracking-wider">Location Complete</p>
            </div>
            <p className="font-mono text-sm font-bold text-white">{locLabel(g)}</p>
          </div>

          {/* Summary */}
          <div className="rounded-2xl overflow-hidden" style={GLASS}>
            <div className="px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.04)" }}>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Picked Summary</p>
            </div>
            {confirmedTasks.map((t, i) => {
              const c = binColor(t.binNo);
              return (
                <div key={i} className="px-4 py-3 flex items-center gap-3"
                  style={i < confirmedTasks.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 text-xs font-bold"
                    style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}>
                    {t.binNo}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-mono text-white">{t.sku}</p>
                    <p className="text-xs text-slate-500 truncate">{t.productName}</p>
                  </div>
                  <p className="text-sm font-bold text-green-400 flex-shrink-0">×{t.pickedQty}</p>
                </div>
              );
            })}
          </div>

          <button onClick={handleNext}
            className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98]"
            style={{ background: "#3b82f6" }}>
            Next Location →
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">Location {locIdx + 1} / {groups.length}</p>
          <p className="text-xs text-slate-500 font-mono truncate">{locLabel(g)}</p>
        </div>
        {step !== "location" && (
          <p className="text-xs text-slate-500 flex-shrink-0">
            Task {taskIdx + 1}/{g.tasks.length}
          </p>
        )}
      </header>

      <main className="flex-1 px-4 pt-4 pb-8 space-y-3 overflow-y-auto">
        {/* Target location card */}
        <div className="rounded-2xl p-4" style={GLASS}>
          <div className="flex items-center gap-2 mb-1">
            <MapPin className="w-4 h-4 text-purple-400" />
            <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Target Location</p>
          </div>
          <p className="text-xl font-bold font-mono text-white">{locLabel(g)}</p>
          {g.locationCode !== locLabel(g) && (
            <p className="text-xs text-slate-500 mt-0.5 font-mono">{g.locationCode}</p>
          )}
        </div>

        {/* ── LOCATION SCAN ── */}
        {step === "location" && (
          <div className="rounded-2xl p-4 space-y-4"
            style={{ ...GLASS, border: "1px solid rgba(139,92,246,0.3)" }}>
            <div className="flex items-center gap-2">
              <ScanLine className="w-4 h-4 text-purple-400" />
              <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Scan Location Barcode</p>
            </div>
            {locError && (
              <div className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs text-red-300"
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
                <span>{locError}</span>
              </div>
            )}
            <input ref={locRef} type="text" value={locScan}
              onChange={(e) => { setLocScan(e.target.value); setLocError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleLocationScan(); }}
              placeholder="Scan location barcode…"
              className="w-full text-center text-base font-mono text-white outline-none rounded-xl py-4"
              style={INPUT_STYLE} />
            <button onClick={handleLocationScan} disabled={!locScan.trim() || locLoading}
              className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: "#7c3aed" }}>
              {locLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
              Confirm Location
            </button>
          </div>
        )}

        {/* ── SKU SCAN ── */}
        {step === "sku" && currentTask && (
          <div className="space-y-3">
            {/* Bin indicator */}
            <div className="rounded-2xl p-4 flex items-center gap-4"
              style={{ ...GLASS, background: binC.bg, border: `1px solid ${binC.border}` }}>
              <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl font-black"
                style={{ background: "rgba(0,0,0,0.3)", color: binC.text }}>
                {currentTask.binNo}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: binC.text }}>BIN {currentTask.binNo}</p>
                <p className="text-xs text-slate-300 font-mono truncate mt-0.5">{currentTask.orderCode}</p>
              </div>
            </div>

            {/* Product info */}
            <div className="rounded-2xl p-4" style={GLASS}>
              <div className="flex items-center gap-2 mb-2">
                <Package className="w-4 h-4 text-green-400" />
                <p className="text-xs font-semibold text-green-300 uppercase tracking-wider">Scan Item</p>
              </div>
              <p className="font-mono text-base font-bold text-white">{currentTask.sku}</p>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{currentTask.productName}</p>
              <p className="text-sm font-bold text-blue-400 mt-1">Qty: {currentTask.allocatedQty}</p>
              {currentTask.lotNo && <p className="text-xs text-slate-500 mt-0.5">LOT: {currentTask.lotNo}</p>}
            </div>

            <div className="rounded-2xl p-4 space-y-3" style={{ ...GLASS, border: "1px solid rgba(34,197,94,0.25)" }}>
              {skuError && (
                <div className="flex items-center gap-2 text-xs text-red-300 rounded-lg px-3 py-2"
                  style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{skuError}
                </div>
              )}
              <input ref={skuRef} type="text" value={skuScan}
                onChange={(e) => { setSkuScan(e.target.value); setSkuError(""); }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSkuScan(); }}
                placeholder="Scan product barcode…"
                className="w-full text-center text-base font-mono text-white outline-none rounded-xl py-4"
                style={INPUT_STYLE} />
              <button onClick={handleSkuScan} disabled={!skuScan.trim()}
                className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "#16a34a" }}>
                <ScanLine className="w-4 h-4" /> Confirm Item
              </button>
            </div>
          </div>
        )}

        {/* ── QTY CONFIRM ── */}
        {step === "qty" && currentTask && (
          <div className="space-y-3">
            <div className="rounded-2xl p-4 flex items-center gap-4"
              style={{ ...GLASS, background: binC.bg, border: `1px solid ${binC.border}` }}>
              <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0 text-2xl font-black"
                style={{ background: "rgba(0,0,0,0.3)", color: binC.text }}>
                {currentTask.binNo}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: binC.text }}>BIN {currentTask.binNo}</p>
                <p className="font-mono text-sm font-bold text-white mt-0.5">{currentTask.sku}</p>
              </div>
            </div>

            <div className="rounded-2xl p-4 space-y-4" style={{ ...GLASS, border: "1px solid rgba(59,130,246,0.3)" }}>
              <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider">Confirm Quantity</p>
              <div className="flex items-center gap-3">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))}
                  className="w-12 h-12 rounded-xl text-slate-300 text-2xl font-bold active:scale-95"
                  style={GLASS}>−</button>
                <input type="number" value={qty} min={1}
                  onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="flex-1 text-center text-3xl font-bold text-white outline-none rounded-xl py-3"
                  style={INPUT_STYLE} />
                <button onClick={() => setQty((q) => q + 1)}
                  className="w-12 h-12 rounded-xl text-slate-300 text-2xl font-bold active:scale-95"
                  style={GLASS}>+</button>
              </div>
              <button onClick={() => setStep("bin")}
                className="w-full py-4 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98]"
                style={{ background: "#3b82f6" }}>
                Confirm →
              </button>
            </div>
          </div>
        )}

        {/* ── BIN ASSIGNMENT ── */}
        {step === "bin" && currentTask && (
          <div className="space-y-3">
            {/* Large BIN tile */}
            <div className="rounded-2xl p-6 flex flex-col items-center gap-3"
              style={{ background: binC.bg, border: `2px solid ${binC.border}` }}>
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: binC.text }}>Put into BIN</p>
              <div className="w-28 h-28 rounded-2xl flex items-center justify-center text-5xl font-black"
                style={{ background: "rgba(0,0,0,0.35)", color: binC.text, border: `2px solid ${binC.border}` }}>
                {currentTask.binNo}
              </div>
              <p className="text-sm font-mono text-slate-300">{currentTask.orderCode}</p>
              <p className="text-lg font-bold text-white">×{qty} units</p>
            </div>

            {confirmError && (
              <div className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs text-red-300"
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
                <span>{confirmError}</span>
              </div>
            )}

            <button onClick={handleBinConfirm} disabled={confirming}
              className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
              style={{ background: "#16a34a" }}>
              {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              {confirming ? "Confirming…" : "Done — Item Placed"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ClusterPickPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" }}>
        <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
      </div>
    }>
      <ClusterPickInner />
    </Suspense>
  );
}
