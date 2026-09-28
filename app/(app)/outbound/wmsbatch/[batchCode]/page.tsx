"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import {
  ChevronLeft, MapPin, ScanLine, AlertCircle,
  CheckCircle2, Loader2, Package, Layers, Plus,
} from "lucide-react";
import { authHeaders } from "@/lib/api";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };
const INPUT_PURPLE = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(139,92,246,0.5)" };
const INPUT_GREEN  = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(34,197,94,0.5)" };
const INPUT_AMBER  = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(245,158,11,0.5)" };

// Step within a single source (assignment):
//   "location" → scan the location barcode
//   "qty"      → confirm how many to pick from this source
//   "sku"      → scan the product barcode
type SourceStep = "location" | "qty" | "sku";

interface Assignment {
  location: string;
  productSku: string;
  lotNo: string;
  expireDate: string;
  qty: number;
  zoneNm: string; aisleNm: string; bayNm: string; levelNm: string; positionNm: string;
}

interface PickedSource {
  locLabel: string;
  qty: number;
}

interface SkuInfo {
  sku: string;
  name: string;
  qtyPerOrder: number;
  totalQty: number;
  assignments: Assignment[];   // all WMS-assigned sources, in order
}

function locLabel(a: Assignment) {
  return [a.zoneNm, a.aisleNm, a.bayNm, a.levelNm, a.positionNm].filter(Boolean).join("-") || a.location;
}
function normalize(s: string) {
  return s.toLowerCase().replace(/[\s\-_/]+/g, "");
}

function WmsBatchPickInner() {
  const router = useRouter();
  const { batchCode } = useParams<{ batchCode: string }>();
  const sp = useSearchParams();
  const warehouseCode = sp.get("wh") ?? "STOO1";
  const orderCount    = Number(sp.get("orders") ?? 0);
  const batchName     = sp.get("name") ?? batchCode;

  const [skuInfos, setSkuInfos] = useState<SkuInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Which SKU we're on
  const [currentIdx, setCurrentIdx] = useState(0);
  // Which assignment (source) within the current SKU
  const [assignmentIdx, setAssignmentIdx] = useState(0);
  // Step within the current source
  const [sourceStep, setSourceStep] = useState<SourceStep>("location");
  // Set of fully-done SKU indices
  const [doneSet, setDoneSet] = useState<Set<number>>(new Set());
  // Per-SKU list of sources actually picked so far
  const [pickedSources, setPickedSources] = useState<Record<number, PickedSource[]>>({});

  // Location scan state
  const [locScan, setLocScan] = useState("");
  const [locError, setLocError] = useState("");
  const [locLoading, setLocLoading] = useState(false);
  // Qty input state (how many to pick from this source)
  const [pickQty, setPickQty] = useState(0);
  // SKU scan state
  const [skuScan, setSkuScan] = useState("");
  const [skuError, setSkuError] = useState("");
  // Additional (unlisted) location scan
  const [addingExtra, setAddingExtra] = useState(false);
  const [extraLocScan, setExtraLocScan] = useState("");
  const [extraLocLabel, setExtraLocLabel] = useState("");
  const [extraLocError, setExtraLocError] = useState("");
  const [extraLocLoading, setExtraLocLoading] = useState(false);
  const [extraPickQty, setExtraPickQty] = useState(1);

  const locRef      = useRef<HTMLInputElement>(null);
  const skuRef      = useRef<HTMLInputElement>(null);
  const extraLocRef = useRef<HTMLInputElement>(null);

  // ── Load batch ────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const ordRes = await fetch("/api/wms/batch/orders", {
          method: "POST", headers: authHeaders(),
          body: JSON.stringify([batchCode]),
        });
        const ordJson = await ordRes.json().catch(() => ({}));
        const orders: { shippingOrderCode: string }[] = Array.isArray(ordJson?.data) ? ordJson.data : [];
        if (!orders.length) { setError("No orders in this batch"); setLoading(false); return; }

        const codes = orders.map((o) => o.shippingOrderCode);
        const firstCode = codes[0];
        const itemRes = await fetch(`/api/wms/shipping/items/${encodeURIComponent(firstCode)}`, { headers: authHeaders() });
        const itemJson = await itemRes.json().catch(() => ({}));
        const d = (itemJson?.data ?? {}) as Record<string, unknown>;
        const items: Record<string, unknown>[] = Array.isArray(d.items) ? d.items : [];
        const assignments: Assignment[] = Array.isArray(d.assignments) ? d.assignments as Assignment[] : [];

        const count = orderCount || orders.length;
        setSkuInfos(items
          .filter((it) => it.productSku)
          .map((it) => {
            const sku = String(it.productSku ?? "");
            const skuAssignments = assignments.filter((a) => a.productSku === sku);
            return {
              sku,
              name: String(it.productName ?? ""),
              qtyPerOrder: Number(it.qty ?? 0),
              totalQty: Number(it.qty ?? 0) * count,
              assignments: skuAssignments,
            };
          })
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load batch");
      } finally {
        setLoading(false);
      }
    })();
  }, [batchCode]); // eslint-disable-line

  // Auto-focus inputs when step changes
  useEffect(() => {
    if (sourceStep === "location") setTimeout(() => locRef.current?.focus(), 100);
    if (sourceStep === "sku") { setSkuScan(""); setSkuError(""); setTimeout(() => skuRef.current?.focus(), 100); }
  }, [sourceStep, currentIdx, assignmentIdx]);

  useEffect(() => {
    if (addingExtra) setTimeout(() => extraLocRef.current?.focus(), 100);
  }, [addingExtra]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function pickedTotal(skuIdx: number) {
    return (pickedSources[skuIdx] ?? []).reduce((s, p) => s + p.qty, 0);
  }

  function remainingQty(skuIdx: number) {
    const info = skuInfos[skuIdx];
    if (!info) return 0;
    return Math.max(0, info.totalQty - pickedTotal(skuIdx));
  }

  // ── Location scan ─────────────────────────────────────────────────────────
  async function handleLocationScan() {
    const current = skuInfos[currentIdx];
    const assignment = current?.assignments[assignmentIdx];
    const raw = locScan.trim();
    if (!raw) return;
    setLocLoading(true); setLocError("");

    const expected  = assignment?.location ?? "";
    const labelExp  = assignment ? locLabel(assignment) : "";
    const scanN     = normalize(raw);
    const locN      = normalize(expected);
    const labelN    = normalize(labelExp);

    const matches = !expected
      || scanN === locN || locN.includes(scanN) || scanN.includes(locN)
      || scanN === labelN || labelN.includes(scanN);

    if (matches) {
      // Default pick qty for this source: assignment qty or remaining needed, whichever smaller
      const qty = assignment
        ? Math.min(assignment.qty, remainingQty(currentIdx))
        : remainingQty(currentIdx);
      setPickQty(Math.max(1, qty));
      setLocScan(""); setLocLoading(false); setSourceStep("qty");
      return;
    }

    try {
      const res = await fetch("/api/wms/warehouse/location-search", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ search: raw, warehouseCode }),
      });
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (res.ok && json) {
        const entry = (Array.isArray(json?.data) ? (json.data as Record<string, unknown>[])[0] : json?.data) as Record<string, unknown> | null;
        if (entry) {
          const scannedCode = String(entry.locationCode ?? raw);
          if (normalize(scannedCode) === locN || normalize(scannedCode).includes(scanN)) {
            const qty = assignment
              ? Math.min(assignment.qty, remainingQty(currentIdx))
              : remainingQty(currentIdx);
            setPickQty(Math.max(1, qty));
            setLocScan(""); setLocLoading(false); setSourceStep("qty");
            return;
          }
        }
      }
    } catch { /* ignore */ }

    setLocError(`Wrong location. Expected: ${labelExp || expected || "(any)"}`);
    setLocLoading(false);
  }

  // ── Confirm qty & advance to SKU scan ─────────────────────────────────────
  function confirmQty() {
    setSourceStep("sku");
  }

  // ── SKU scan ──────────────────────────────────────────────────────────────
  function handleSkuScan() {
    const current = skuInfos[currentIdx];
    if (!current) return;
    const raw = skuScan.trim();
    if (!raw) return;
    if (raw.toLowerCase() !== current.sku.toLowerCase()) {
      setSkuError(`Expected: ${current.sku}`);
      return;
    }

    // Record this pick
    const assignment = current.assignments[assignmentIdx];
    const label = assignment ? locLabel(assignment) : "Unknown";
    setPickedSources((prev) => {
      const existing = prev[currentIdx] ?? [];
      return { ...prev, [currentIdx]: [...existing, { locLabel: label, qty: pickQty }] };
    });

    const newTotal = pickedTotal(currentIdx) + pickQty;
    const stillNeeded = current.totalQty - newTotal;

    if (stillNeeded <= 0) {
      // SKU fully picked
      markSkuDone(currentIdx);
    } else {
      // Need more — try next assignment
      const nextAssignmentIdx = assignmentIdx + 1;
      if (nextAssignmentIdx < current.assignments.length) {
        setAssignmentIdx(nextAssignmentIdx);
        setSourceStep("location");
        setLocScan(""); setLocError("");
      } else {
        // No more pre-assigned locations — prompt for extra
        setAssignmentIdx(nextAssignmentIdx);
        setSourceStep("location"); // will show "no assignment" UI
        setLocScan(""); setLocError("");
      }
    }
  }

  function markSkuDone(skuIdx: number) {
    setDoneSet((prev) => {
      const next = new Set(prev);
      next.add(skuIdx);
      const nextIdx = skuInfos.findIndex((_, i) => i > skuIdx && !next.has(i));
      if (nextIdx >= 0) {
        setCurrentIdx(nextIdx);
        setAssignmentIdx(0);
        setSourceStep("location");
        setLocScan(""); setLocError("");
      }
      return next;
    });
  }

  // ── Extra (unlisted) location scan ────────────────────────────────────────
  async function handleExtraLocScan() {
    const raw = extraLocScan.trim();
    if (!raw) return;
    setExtraLocLoading(true); setExtraLocError("");
    try {
      const res = await fetch("/api/wms/warehouse/location-search", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ search: raw, warehouseCode }),
      });
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (res.ok && json) {
        const entry = (Array.isArray(json?.data) ? (json.data as Record<string, unknown>[])[0] : json?.data) as Record<string, unknown> | null;
        if (entry) {
          const label = [entry.zoneNm, entry.aisleNm, entry.bayNm, entry.levelNm, entry.positionNm].filter(Boolean).join("-")
            || String(entry.locationCode ?? raw);
          setExtraLocLabel(label);
          setExtraLocScan("");
          setExtraPickQty(Math.max(1, remainingQty(currentIdx)));
          setExtraLocLoading(false);
          return;
        }
      }
    } catch { /* ignore */ }
    // Accept the raw scan as-is
    setExtraLocLabel(raw);
    setExtraLocScan("");
    setExtraPickQty(Math.max(1, remainingQty(currentIdx)));
    setExtraLocLoading(false);
  }

  function confirmExtraPick() {
    const current = skuInfos[currentIdx];
    if (!current || !extraLocLabel) return;
    setPickedSources((prev) => {
      const existing = prev[currentIdx] ?? [];
      return { ...prev, [currentIdx]: [...existing, { locLabel: extraLocLabel, qty: extraPickQty }] };
    });
    const newTotal = pickedTotal(currentIdx) + extraPickQty;
    setExtraLocLabel(""); setExtraLocScan(""); setAddingExtra(false);
    if (newTotal >= current.totalQty) {
      markSkuDone(currentIdx);
    }
  }

  // ── Mark batch done ───────────────────────────────────────────────────────
  function completeBatch() {
    try {
      const existing = JSON.parse(sessionStorage.getItem("wmsbatch_done") ?? "[]") as string[];
      sessionStorage.setItem("wmsbatch_done", JSON.stringify([...new Set([...existing, batchCode])]));
    } catch { /* ignore */ }
    router.replace("/outbound/wmsbatch");
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={DARK}>
      <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
    </div>
  );
  if (error) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-6" style={DARK}>
      <AlertCircle className="w-10 h-10 text-red-400" />
      <p className="text-red-300 text-sm text-center">{error}</p>
      <button onClick={() => router.back()} className="text-blue-400 text-sm">← Back</button>
    </div>
  );

  const current    = skuInfos[currentIdx];
  const allDone    = skuInfos.length > 0 && doneSet.size >= skuInfos.length;
  const assignment = current?.assignments[assignmentIdx] ?? null;
  const hasMoreAssignments = current && assignmentIdx < current.assignments.length;

  // ── ALL DONE ───────────────────────────────────────────────────────────────
  if (allDone) return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3" style={HDR_BORDER}>
        <button onClick={() => router.replace("/outbound/wmsbatch")} className="p-1 text-slate-400 active:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <p className="text-base font-bold text-white">Batch Complete</p>
      </header>
      <main className="flex-1 px-4 pt-6 pb-8 space-y-4">
        <div className="rounded-2xl p-6 flex flex-col items-center gap-3 text-center"
          style={{ ...GLASS, border: "1px solid rgba(34,197,94,0.3)", background: "rgba(34,197,94,0.08)" }}>
          <CheckCircle2 className="w-14 h-14 text-green-400" />
          <p className="text-lg font-bold text-white">All SKUs Picked!</p>
          <p className="text-xs text-slate-400">{batchName}</p>
          <p className="text-xs text-slate-500">{orderCount} orders · {skuInfos.length} SKU{skuInfos.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-2xl overflow-hidden" style={GLASS}>
          {skuInfos.map((info, i) => {
            const sources = pickedSources[i] ?? [];
            return (
              <div key={info.sku} className="px-4 py-3"
                style={i < skuInfos.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm font-bold text-white">{info.sku}</p>
                    {sources.map((s, si) => (
                      <p key={si} className="text-xs text-slate-500 truncate mt-0.5">{s.locLabel} × {s.qty}</p>
                    ))}
                  </div>
                  <p className="text-sm font-bold text-green-400 flex-shrink-0">×{info.totalQty}</p>
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={completeBatch}
          className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          style={{ background: "#7c3aed" }}>
          <CheckCircle2 className="w-5 h-5" /> Done — Close Batch
        </button>
      </main>
    </div>
  );

  // ── PICK SCREEN ────────────────────────────────────────────────────────────
  const picked  = pickedTotal(currentIdx);
  const needed  = current?.totalQty ?? 0;
  const remaining = remainingQty(currentIdx);

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white truncate">{batchName}</p>
          <p className="text-xs text-slate-500">SKU {currentIdx + 1}/{skuInfos.length} · {orderCount} orders</p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {skuInfos.map((_, i) => (
            <div key={i} className="w-2 h-2 rounded-full transition-all" style={{
              background: doneSet.has(i) ? "#22c55e" : i === currentIdx ? "#a78bfa" : "rgba(255,255,255,0.15)",
            }} />
          ))}
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 pb-8 space-y-3 overflow-y-auto">
        {/* SKU list */}
        <div className="rounded-2xl overflow-hidden" style={GLASS}>
          <div className="px-4 py-2.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(139,92,246,0.1)" }}>
            <div className="flex items-center gap-2">
              <Layers className="w-3.5 h-3.5 text-violet-400" />
              <p className="text-xs font-semibold text-violet-400 uppercase tracking-wider">Pick List</p>
            </div>
          </div>
          {skuInfos.map((info, i) => {
            const isDone    = doneSet.has(i);
            const isCurrent = i === currentIdx;
            const pt = pickedTotal(i);
            return (
              <button key={info.sku}
                onClick={() => { if (!isDone) { setCurrentIdx(i); setAssignmentIdx(0); setSourceStep("location"); setLocScan(""); setLocError(""); setAddingExtra(false); } }}
                className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-white/5 transition-colors"
                style={i < skuInfos.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${isDone ? "bg-green-500/20" : isCurrent ? "bg-violet-500/20" : "bg-white/5"}`}>
                  {isDone
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                    : <span className="text-xs font-bold" style={{ color: isCurrent ? "#a78bfa" : "#475569" }}>{i + 1}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-mono text-sm font-bold truncate ${isDone ? "text-slate-500" : isCurrent ? "text-white" : "text-slate-400"}`}>{info.sku}</p>
                  {info.assignments[0]
                    ? <p className="text-xs text-slate-500 truncate mt-0.5">{locLabel(info.assignments[0])}{info.assignments.length > 1 ? ` +${info.assignments.length - 1}` : ""}</p>
                    : <p className="text-xs text-amber-500 mt-0.5">No location assigned</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  {pt > 0 && !isDone && <p className="text-[10px] text-amber-400">{pt}/{info.totalQty}</p>}
                  <p className={`text-sm font-bold ${isDone ? "text-green-400" : isCurrent ? "text-violet-300" : "text-slate-500"}`}>×{info.totalQty}</p>
                </div>
              </button>
            );
          })}
        </div>

        {current && !doneSet.has(currentIdx) && (
          <>
            {/* Current pick info card */}
            <div className="rounded-2xl p-4" style={{ ...GLASS, border: "1px solid rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.08)" }}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin className="w-3.5 h-3.5 text-violet-400" />
                    <p className="text-xs font-semibold text-violet-300 uppercase tracking-wider">
                      Pick From {current.assignments.length > 1 ? `(${assignmentIdx + 1}/${Math.max(current.assignments.length, assignmentIdx + 1)})` : ""}
                    </p>
                  </div>
                  {assignment ? (
                    <>
                      <p className="text-lg font-bold font-mono text-white">{locLabel(assignment)}</p>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">{assignment.location}</p>
                      {assignment.lotNo && (
                        <p className="text-xs text-slate-500 mt-1">
                          LOT: {assignment.lotNo}{assignment.expireDate ? ` · EXP: ${assignment.expireDate}` : ""}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-amber-400">Scan any location with remaining stock</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1.5 justify-end mb-0.5">
                    <Package className="w-3.5 h-3.5 text-violet-400" />
                    <p className="text-xs text-slate-400">{current.qtyPerOrder}/order × {orderCount}</p>
                  </div>
                  <p className="text-3xl font-black text-violet-300">×{remaining}</p>
                  <p className="text-xs text-slate-500">remaining{picked > 0 ? ` (${picked} picked)` : ""}</p>
                </div>
              </div>
              <p className="font-mono text-sm font-bold text-white mt-3 truncate">{current.sku}</p>
              {current.name && <p className="text-xs text-slate-400 truncate">{current.name}</p>}

              {/* Picked sources so far */}
              {(pickedSources[currentIdx] ?? []).length > 0 && (
                <div className="mt-3 space-y-1">
                  {(pickedSources[currentIdx] ?? []).map((s, si) => (
                    <div key={si} className="flex items-center gap-2 text-xs">
                      <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />
                      <span className="text-green-300 font-mono">{s.locLabel}</span>
                      <span className="text-green-400 font-bold">×{s.qty}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Step: SCAN LOCATION */}
            {sourceStep === "location" && !addingExtra && (
              <div className="rounded-2xl p-4 space-y-4" style={{ ...GLASS, border: "1px solid rgba(139,92,246,0.35)" }}>
                <div className="flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-violet-400" />
                  <p className="text-xs font-semibold text-violet-300 uppercase tracking-wider">
                    Step {assignmentIdx + 1} — Scan Location
                  </p>
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
                  placeholder={assignment ? "Scan location barcode…" : "Scan any location barcode…"}
                  className="w-full text-center text-base font-mono text-white outline-none rounded-xl py-4"
                  style={INPUT_PURPLE} />
                <button onClick={handleLocationScan} disabled={!locScan.trim() || locLoading}
                  className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98]"
                  style={{ background: "#7c3aed" }}>
                  {locLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                  Confirm Location
                </button>
              </div>
            )}

            {/* Step: QTY CONFIRM */}
            {sourceStep === "qty" && !addingExtra && (
              <div className="rounded-2xl p-4 space-y-4" style={{ ...GLASS, border: "1px solid rgba(245,158,11,0.35)" }}>
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-amber-400" />
                  <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Qty to Pick from This Location</p>
                </div>
                <div className="flex items-center justify-center gap-4">
                  <button onClick={() => setPickQty((q) => Math.max(1, q - 1))}
                    className="w-12 h-12 rounded-xl text-2xl font-bold text-white flex items-center justify-center active:scale-95"
                    style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)" }}>−</button>
                  <input
                    type="number" min={1} max={remaining}
                    value={pickQty}
                    onChange={(e) => setPickQty(Math.max(1, Math.min(remaining, Number(e.target.value) || 1)))}
                    className="w-24 text-center text-3xl font-black text-white outline-none rounded-xl py-3"
                    style={INPUT_AMBER}
                  />
                  <button onClick={() => setPickQty((q) => Math.min(remaining, q + 1))}
                    className="w-12 h-12 rounded-xl text-2xl font-bold text-white flex items-center justify-center active:scale-95"
                    style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)" }}>+</button>
                </div>
                {pickQty < remaining && (
                  <p className="text-center text-xs text-amber-400">
                    {remaining - pickQty} more needed after this pick
                  </p>
                )}
                <button onClick={confirmQty}
                  className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98]"
                  style={{ background: "#d97706" }}>
                  <CheckCircle2 className="w-4 h-4" /> Confirm Qty (×{pickQty})
                </button>
              </div>
            )}

            {/* Step: SCAN SKU */}
            {sourceStep === "sku" && !addingExtra && (
              <div className="rounded-2xl p-4 space-y-4" style={{ ...GLASS, border: "1px solid rgba(34,197,94,0.35)" }}>
                <div className="flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-green-400" />
                  <p className="text-xs font-semibold text-green-300 uppercase tracking-wider">Step — Scan Product</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <p className="text-xs text-green-300">Location confirmed · picking ×{pickQty}</p>
                </div>
                {skuError && (
                  <div className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs text-red-300"
                    style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
                    <span>{skuError}</span>
                  </div>
                )}
                <input ref={skuRef} type="text" value={skuScan}
                  onChange={(e) => { setSkuScan(e.target.value); setSkuError(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSkuScan(); }}
                  placeholder="Scan product barcode…"
                  className="w-full text-center text-base font-mono text-white outline-none rounded-xl py-4"
                  style={INPUT_GREEN} />
                <button onClick={handleSkuScan} disabled={!skuScan.trim()}
                  className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98]"
                  style={{ background: "#16a34a" }}>
                  <ScanLine className="w-4 h-4" />
                  Confirm Product (×{pickQty} units)
                </button>
              </div>
            )}

            {/* Extra location scan (when all assignments exhausted but qty still needed) */}
            {!addingExtra && !hasMoreAssignments && sourceStep === "location" && picked > 0 && (
              <button
                onClick={() => { setAddingExtra(true); setExtraLocLabel(""); setExtraLocScan(""); setExtraLocError(""); }}
                className="w-full py-3.5 rounded-xl text-sm font-semibold text-amber-300 flex items-center justify-center gap-2 active:scale-[0.98]"
                style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}>
                <Plus className="w-4 h-4" /> Pick {remaining} more from another location
              </button>
            )}

            {addingExtra && (
              <div className="rounded-2xl p-4 space-y-4" style={{ ...GLASS, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.05)" }}>
                <div className="flex items-center gap-2">
                  <Plus className="w-4 h-4 text-amber-400" />
                  <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider">Additional Location</p>
                  <span className="text-xs text-slate-500 ml-auto">{remaining} needed</span>
                </div>

                {!extraLocLabel ? (
                  <>
                    {extraLocError && (
                      <div className="flex items-start gap-2 rounded-xl px-3 py-2 text-xs text-red-300"
                        style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
                        <span>{extraLocError}</span>
                      </div>
                    )}
                    <input ref={extraLocRef} type="text" value={extraLocScan}
                      onChange={(e) => { setExtraLocScan(e.target.value); setExtraLocError(""); }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleExtraLocScan(); }}
                      placeholder="Scan additional location…"
                      className="w-full text-center text-base font-mono text-white outline-none rounded-xl py-4"
                      style={INPUT_AMBER} />
                    <button onClick={handleExtraLocScan} disabled={!extraLocScan.trim() || extraLocLoading}
                      className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98]"
                      style={{ background: "#d97706" }}>
                      {extraLocLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                      Confirm Location
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                      style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.25)" }}>
                      <MapPin className="w-4 h-4 text-amber-400 flex-shrink-0" />
                      <p className="text-sm font-mono font-bold text-amber-200">{extraLocLabel}</p>
                    </div>
                    <div className="flex items-center justify-center gap-4">
                      <button onClick={() => setExtraPickQty((q) => Math.max(1, q - 1))}
                        className="w-12 h-12 rounded-xl text-2xl font-bold text-white flex items-center justify-center active:scale-95"
                        style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)" }}>−</button>
                      <input
                        type="number" min={1} max={remaining}
                        value={extraPickQty}
                        onChange={(e) => setExtraPickQty(Math.max(1, Math.min(remaining, Number(e.target.value) || 1)))}
                        className="w-24 text-center text-3xl font-black text-white outline-none rounded-xl py-3"
                        style={INPUT_AMBER}
                      />
                      <button onClick={() => setExtraPickQty((q) => Math.min(remaining, q + 1))}
                        className="w-12 h-12 rounded-xl text-2xl font-bold text-white flex items-center justify-center active:scale-95"
                        style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)" }}>+</button>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => { setAddingExtra(false); setExtraLocLabel(""); }}
                        className="flex-1 py-3 rounded-xl text-sm font-semibold text-slate-300 active:scale-[0.98]"
                        style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}>
                        Cancel
                      </button>
                      <button onClick={confirmExtraPick}
                        className="flex-2 flex-[2] py-3 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98]"
                        style={{ background: "#d97706" }}>
                        <CheckCircle2 className="w-4 h-4" /> Pick ×{extraPickQty}
                      </button>
                    </div>
                  </>
                )}
                <button onClick={() => { setAddingExtra(false); setExtraLocLabel(""); }}
                  className="w-full text-center text-xs text-slate-500 underline py-1">
                  Cancel
                </button>
              </div>
            )}

            {/* Skip if no assignment and nothing picked yet */}
            {sourceStep === "location" && !assignment && !addingExtra && picked === 0 && (
              <button onClick={() => markSkuDone(currentIdx)}
                className="w-full py-3.5 rounded-xl text-sm font-semibold text-amber-300 flex items-center justify-center gap-2 active:scale-[0.98]"
                style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.3)" }}>
                Skip (no location assigned)
              </button>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default function WmsBatchPickPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" }}>
        <Loader2 className="w-8 h-8 animate-spin text-violet-400" />
      </div>
    }>
      <WmsBatchPickInner />
    </Suspense>
  );
}
