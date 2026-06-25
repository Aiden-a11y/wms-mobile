"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import {
  ChevronLeft, MapPin, ScanLine, AlertCircle,
  CheckCircle2, Loader2, Package, Layers,
} from "lucide-react";
import { authHeaders } from "@/lib/api";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };
const INPUT_PURPLE = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(139,92,246,0.5)" };
const INPUT_GREEN  = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(34,197,94,0.5)" };

type Step = "location" | "sku" | "done_sku";

interface Assignment {
  location: string;
  productSku: string;
  lotNo: string;
  expireDate: string;
  qty: number;
  zoneNm: string; aisleNm: string; bayNm: string; levelNm: string; positionNm: string;
}

interface SkuInfo {
  sku: string;
  name: string;
  qtyPerOrder: number;
  totalQty: number;
  assignment: Assignment | null;
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
  const customerCode  = sp.get("cust") ?? "";
  const batchName     = sp.get("name") ?? batchCode;
  const orderCount    = Number(sp.get("orders") ?? 0);

  const [skuInfos, setSkuInfos] = useState<SkuInfo[]>([]);
  const [orderCodes, setOrderCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [currentIdx, setCurrentIdx] = useState(0);
  const [step, setStep] = useState<Step>("location");
  const [doneSet, setDoneSet] = useState<Set<number>>(new Set());

  const [locScan, setLocScan] = useState("");
  const [locError, setLocError] = useState("");
  const [locLoading, setLocLoading] = useState(false);

  const [skuScan, setSkuScan] = useState("");
  const [skuError, setSkuError] = useState("");

  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState("");

  const locRef = useRef<HTMLInputElement>(null);
  const skuRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        // 1. Get orders in this batch
        const ordRes = await fetch("/api/wms/batch/orders", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify([batchCode]),
        });
        const ordJson = await ordRes.json().catch(() => ({}));
        const orders: { shippingOrderCode: string }[] = Array.isArray(ordJson?.data) ? ordJson.data : [];
        if (!orders.length) { setError("No orders in this batch"); setLoading(false); return; }

        const codes = orders.map((o) => o.shippingOrderCode);
        setOrderCodes(codes);

        // 2. Get items + assignments from first order
        const firstCode = codes[0];
        const itemRes = await fetch(`/api/wms/shipping/items/${encodeURIComponent(firstCode)}`, { headers: authHeaders() });
        const itemJson = await itemRes.json().catch(() => ({}));
        const d = (itemJson?.data ?? {}) as Record<string, unknown>;
        const items: Record<string, unknown>[] = Array.isArray(d.items) ? d.items : [];
        const assignments: Assignment[] = Array.isArray(d.assignments) ? d.assignments as Assignment[] : [];

        const count = orderCount || orders.length;

        setSkuInfos(items
          .filter((it) => it.productSku)
          .map((it) => ({
            sku: String(it.productSku ?? ""),
            name: String(it.productName ?? ""),
            qtyPerOrder: Number(it.qty ?? 0),
            totalQty: Number(it.qty ?? 0) * count,
            assignment: assignments.find((a) => a.productSku === String(it.productSku ?? "")) ?? null,
          }))
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load batch");
      } finally {
        setLoading(false);
      }
    })();
  }, [batchCode]); // eslint-disable-line

  useEffect(() => {
    if (step === "location") setTimeout(() => locRef.current?.focus(), 100);
    if (step === "sku") { setSkuScan(""); setSkuError(""); setTimeout(() => skuRef.current?.focus(), 100); }
  }, [step, currentIdx]);

  // ── Location scan ──────────────────────────────────────────────────────────
  async function handleLocationScan() {
    const current = skuInfos[currentIdx];
    if (!current?.assignment) return;
    const raw = locScan.trim();
    if (!raw) return;
    setLocLoading(true); setLocError("");

    const expected = current.assignment.location;
    const labelExp = locLabel(current.assignment);
    const scanN    = normalize(raw);
    const locN     = normalize(expected);
    const labelN   = normalize(labelExp);

    if (!expected || scanN === locN || locN.includes(scanN) || scanN.includes(locN) || scanN === labelN || labelN.includes(scanN)) {
      setLocScan(""); setLocLoading(false); setStep("sku"); return;
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
            setLocScan(""); setLocLoading(false); setStep("sku"); return;
          }
        }
      }
    } catch { /* ignore */ }

    setLocError(`Wrong location. Expected: ${labelExp || expected}`);
    setLocLoading(false);
  }

  // ── SKU scan ───────────────────────────────────────────────────────────────
  function handleSkuScan() {
    const current = skuInfos[currentIdx];
    if (!current) return;
    const raw = skuScan.trim();
    if (!raw) return;
    if (raw.toLowerCase() === current.sku.toLowerCase()) {
      markSkuDone();
    } else {
      setSkuError(`Expected: ${current.sku}`);
    }
  }

  function markSkuDone() {
    setDoneSet((prev) => {
      const next = new Set(prev);
      next.add(currentIdx);
      // Advance to next undone SKU
      const nextIdx = skuInfos.findIndex((_, i) => i > currentIdx && !next.has(i));
      if (nextIdx >= 0) {
        setCurrentIdx(nextIdx);
        setStep("location");
        setLocScan(""); setLocError("");
      }
      return next;
    });
  }

  // ── Complete all orders ────────────────────────────────────────────────────
  async function completeBatch() {
    if (!orderCodes.length) { router.replace("/outbound/wmsbatch"); return; }
    setCompleting(true); setCompleteError("");
    try {
      const body = {
        warehouseCode,
        customerCode,
        orderCodes,
        newStatus: "FA",
        completeDate: "",
        cancelComment: "",
      };
      const res = await fetch("/api/wms/shipping/status-change", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      const ok = !!(res.ok && ((json as Record<string, unknown>)?.isSuccess ?? true));
      if (!ok) {
        setCompleteError(String((json as Record<string, unknown>)?.message ?? "Status change failed"));
        setCompleting(false);
        return;
      }
      router.replace("/outbound/wmsbatch");
    } catch (e) {
      setCompleteError(e instanceof Error ? e.message : "Failed to complete");
      setCompleting(false);
    }
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

  const current = skuInfos[currentIdx];
  const allDone = skuInfos.length > 0 && doneSet.size >= skuInfos.length;

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

        {/* Summary list */}
        <div className="rounded-2xl overflow-hidden" style={GLASS}>
          {skuInfos.map((info, i) => (
            <div key={info.sku} className="px-4 py-3 flex items-center gap-3"
              style={i < skuInfos.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}>
              <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm font-bold text-white">{info.sku}</p>
                {info.assignment && <p className="text-xs text-slate-500 truncate mt-0.5">{locLabel(info.assignment)}</p>}
              </div>
              <p className="text-sm font-bold text-green-400 flex-shrink-0">×{info.totalQty}</p>
            </div>
          ))}
        </div>

        {completeError && (
          <div className="rounded-2xl p-3 flex items-start gap-2"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-red-300">{completeError}</p>
          </div>
        )}

        <button
          onClick={completeBatch}
          disabled={completing}
          className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60 transition-all"
          style={{ background: "#7c3aed" }}
        >
          {completing
            ? <><Loader2 className="w-5 h-5 animate-spin" /> Completing…</>
            : <><CheckCircle2 className="w-5 h-5" /> Complete &amp; Close Batch</>}
        </button>
      </main>
    </div>
  );

  // ── PICK SCREEN ────────────────────────────────────────────────────────────
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
        {/* Progress dots */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {skuInfos.map((_, i) => (
            <div key={i} className="w-2 h-2 rounded-full transition-all" style={{
              background: doneSet.has(i) ? "#22c55e" : i === currentIdx ? "#a78bfa" : "rgba(255,255,255,0.15)",
            }} />
          ))}
        </div>
      </header>

      <main className="flex-1 px-4 pt-4 pb-8 space-y-3 overflow-y-auto">
        {/* SKU overview list */}
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
            return (
              <button key={info.sku}
                onClick={() => { if (!isDone) { setCurrentIdx(i); setStep("location"); setLocScan(""); setLocError(""); } }}
                className="w-full px-4 py-3 flex items-center gap-3 text-left active:bg-white/5 transition-colors"
                style={i < skuInfos.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${isDone ? "bg-green-500/20" : isCurrent ? "bg-violet-500/20" : "bg-white/5"}`}>
                  {isDone
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                    : <span className="text-xs font-bold" style={{ color: isCurrent ? "#a78bfa" : "#475569" }}>{i + 1}</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-mono text-sm font-bold truncate ${isDone ? "text-slate-500" : isCurrent ? "text-white" : "text-slate-400"}`}>{info.sku}</p>
                  {info.assignment
                    ? <p className="text-xs text-slate-500 truncate mt-0.5">{locLabel(info.assignment)}</p>
                    : <p className="text-xs text-amber-500 mt-0.5">No location assigned</p>}
                </div>
                <p className={`text-sm font-bold flex-shrink-0 ${isDone ? "text-green-400" : isCurrent ? "text-violet-300" : "text-slate-500"}`}>×{info.totalQty}</p>
              </button>
            );
          })}
        </div>

        {/* Current SKU pick card */}
        {current && !doneSet.has(currentIdx) && (
          <>
            {/* Location + qty info */}
            <div className="rounded-2xl p-4" style={{ ...GLASS, border: "1px solid rgba(139,92,246,0.3)", background: "rgba(139,92,246,0.08)" }}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <MapPin className="w-3.5 h-3.5 text-violet-400" />
                    <p className="text-xs font-semibold text-violet-300 uppercase tracking-wider">Pick From</p>
                  </div>
                  {current.assignment
                    ? <>
                        <p className="text-lg font-bold font-mono text-white">{locLabel(current.assignment)}</p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">{current.assignment.location}</p>
                        {current.assignment.lotNo && (
                          <p className="text-xs text-slate-500 mt-1">
                            LOT: {current.assignment.lotNo}
                            {current.assignment.expireDate ? ` · EXP: ${current.assignment.expireDate}` : ""}
                          </p>
                        )}
                      </>
                    : <p className="text-sm text-amber-400">No location — assign from dashboard</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="flex items-center gap-1.5 justify-end mb-0.5">
                    <Package className="w-3.5 h-3.5 text-violet-400" />
                    <p className="text-xs text-slate-400">{current.qtyPerOrder}/order × {orderCount}</p>
                  </div>
                  <p className="text-3xl font-black text-violet-300">×{current.totalQty}</p>
                  <p className="text-xs text-slate-500">total</p>
                </div>
              </div>
              <p className="font-mono text-sm font-bold text-white mt-3 truncate">{current.sku}</p>
              {current.name && <p className="text-xs text-slate-400 truncate">{current.name}</p>}
            </div>

            {/* Step: SCAN LOCATION */}
            {step === "location" && current.assignment && (
              <div className="rounded-2xl p-4 space-y-4" style={{ ...GLASS, border: "1px solid rgba(139,92,246,0.35)" }}>
                <div className="flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-violet-400" />
                  <p className="text-xs font-semibold text-violet-300 uppercase tracking-wider">Step 1 — Scan Location</p>
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
                  style={INPUT_PURPLE} />
                <button onClick={handleLocationScan} disabled={!locScan.trim() || locLoading}
                  className="w-full py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98]"
                  style={{ background: "#7c3aed" }}>
                  {locLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                  Confirm Location
                </button>
              </div>
            )}

            {/* Step: SCAN SKU */}
            {step === "sku" && (
              <div className="rounded-2xl p-4 space-y-4" style={{ ...GLASS, border: "1px solid rgba(34,197,94,0.35)" }}>
                <div className="flex items-center gap-2">
                  <ScanLine className="w-4 h-4 text-green-400" />
                  <p className="text-xs font-semibold text-green-300 uppercase tracking-wider">Step 2 — Scan Product</p>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl"
                  style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)" }}>
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                  <p className="text-xs text-green-300">Location confirmed ✓</p>
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
                  Confirm Product (×{current.totalQty} units)
                </button>
              </div>
            )}

            {/* Skip: if no assignment, allow bypassing location scan */}
            {step === "location" && !current.assignment && (
              <button onClick={markSkuDone}
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
