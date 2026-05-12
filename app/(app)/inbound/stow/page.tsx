"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft, CheckCircle2, MapPin, Package,
  RefreshCw, ScanLine, AlertCircle, Loader2, RotateCcw,
} from "lucide-react";
import { authHeaders } from "@/lib/api";
import type { PersistedStowTag } from "@/lib/stow-tags";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = {
  background: "rgba(255,255,255,0.06)",
  backdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.08)",
};
const INPUT_STYLE = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(59,130,246,0.5)" };

type Step = "qty" | "location" | "confirm" | "done";

interface LocationInfo {
  locationCode: string;
  locationId: string;
  zoneName: string;
  aisleName: string;
  bayName: string;
  levelName: string;
  positionName: string;
}

const STEP_LABELS: { key: Step; label: string }[] = [
  { key: "qty",      label: "Quantity" },
  { key: "location", label: "Location" },
  { key: "confirm",  label: "Confirm" },
];

function StepBar({ current }: { current: Step }) {
  const order: Step[] = ["qty", "location", "confirm", "done"];
  const idx = order.indexOf(current);
  return (
    <div className="flex items-center px-5 py-3 gap-1" style={HDR_BORDER}>
      {STEP_LABELS.map((s, i) => {
        const done = idx > i;
        const active = idx === i;
        return (
          <div key={s.key} className="flex items-center gap-1 flex-1 last:flex-none">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
              style={
                done   ? { background: "rgba(34,197,94,0.25)",  color: "#4ade80", border: "1px solid rgba(34,197,94,0.4)" }
                : active ? { background: "rgba(59,130,246,0.3)",  color: "#93c5fd", border: "1px solid rgba(59,130,246,0.5)" }
                :          { background: "rgba(255,255,255,0.06)", color: "#64748b", border: "1px solid rgba(255,255,255,0.08)" }
              }
            >
              {done ? "✓" : i + 1}
            </div>
            <span className={`text-xs ${active ? "text-blue-300 font-semibold" : "text-slate-500"}`}>{s.label}</span>
            {i < STEP_LABELS.length - 1 && (
              <div className="flex-1 mx-1 h-px"
                style={{ background: done ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.1)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function locLabel(loc: LocationInfo): string {
  return [loc.zoneName, loc.aisleName, loc.bayName, loc.levelName, loc.positionName]
    .filter(Boolean).join(" - ") || loc.locationCode;
}

function StowFlowInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tagId = searchParams.get("id");

  const [loadingTag, setLoadingTag] = useState(true);
  const [tag, setTag] = useState<PersistedStowTag | null>(null);
  const [loadError, setLoadError] = useState("");

  const [step, setStep] = useState<Step>("qty");
  const [qty, setQty] = useState(0);
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const locationRef = useRef<LocationInfo | null>(null); // survives re-renders
  const rawScanRef = useRef<string>(""); // raw barcode, always set before state updates
  const [locScan, setLocScan] = useState("");
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");

  const locRef = useRef<HTMLInputElement>(null);

  // ── Load tag from Redis ──────────────────────────────────
  useEffect(() => {
    if (!tagId) {
      setLoadError("No tag ID provided. Go back and tap Stow.");
      setLoadingTag(false);
      return;
    }
    async function fetchTag() {
      setLoadingTag(true);
      try {
        const res = await fetch("/api/stow-tags?pending=true");
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          setLoadError(
            `Server error ${res.status}: ${json?.error ?? "Redis may not be configured in Vercel.\nAdd KV_REST_API_URL and KV_REST_API_TOKEN to Vercel env vars."}`
          );
          setLoadingTag(false);
          return;
        }
        const all: PersistedStowTag[] = Array.isArray(json) ? json : [];
        let found = all.find((t) => String(t.id) === tagId);
        if (!found) {
          setLoadError(`Tag ID ${tagId} not found in pending tags (${all.length} total loaded).`);
          setLoadingTag(false);
          return;
        }

        // If tag is missing customerCode or warehouseCd, fetch from Spider WMS
        if (!found.customerCode || !found.warehouseCd) {
          try {
            const headers = authHeaders();
            const orderRes = await fetch(
              `/api/wms/receiving/items/${found.orderCode}`,
              { headers }
            );
            const orderJson = await orderRes.json().catch(() => null);
            const items: Record<string, unknown>[] =
              Array.isArray(orderJson?.data?.items) ? orderJson.data.items :
              Array.isArray(orderJson?.data?.list)  ? orderJson.data.list  :
              Array.isArray(orderJson?.data)        ? orderJson.data       : [];
            const item = items.find(
              (r) => Number(r.receiveItemId ?? r.itemId) === found!.receiveItemId
            ) ?? items[0];
            if (item) {
              found = {
                ...found,
                customerCode: found.customerCode || String(item.customerCode ?? ""),
                warehouseCode: found.warehouseCode || String(item.warehouseCode ?? "STOO1"),
                warehouseCd:   found.warehouseCd   || String(item.warehouseCd  ?? item.warehouseId ?? ""),
              };
            }
          } catch { /* ignore — proceed with partial data */ }
        }

        setTag(found);
        setQty(found.qty);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Network error loading tag");
      }
      setLoadingTag(false);
    }
    fetchTag();
  }, [tagId]);

  useEffect(() => {
    if (step === "location") setTimeout(() => locRef.current?.focus(), 100);
  }, [step]);

  // ── Location scan ────────────────────────────────────────
  async function handleLocationScan() {
    const raw = locScan.trim();
    if (!raw || !tag) return;
    setLocLoading(true);
    setLocError("");
    try {
      // POST with { search, warehouseCode } — confirmed correct from network capture
      const wc = tag.warehouseCode || "STOO1";   // fallback: only one warehouse
      const body: Record<string, string> = { search: raw, warehouseCode: wc };

      const res = await fetch(`/api/wms/warehouse/location-search`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setLocError(`Location API error ${res.status}: ${json?.message ?? JSON.stringify(json)?.slice(0, 150)}`);
        setLocLoading(false);
        return;
      }

      // Response: { data: [{warehouseCd, zoneName, aisleName, bayName, levelName, positionName}] }
      const dataRaw = json?.data;
      const d = (Array.isArray(dataRaw) ? dataRaw[0] : dataRaw) as Record<string, unknown> | null ?? null;

      if (!d) {
        setLocError(`Location "${raw}" not found. API: ${JSON.stringify(json).slice(0, 200)}`);
        setLocLoading(false);
        return;
      }

      const zoneName    = String(d.zoneName    ?? d.zone     ?? "");
      const aisleName   = String(d.aisleName   ?? d.aisle    ?? "");
      const bayName     = String(d.bayName     ?? d.bay      ?? "");
      const levelName   = String(d.levelName   ?? d.level    ?? "");
      const positionName= String(d.positionName ?? d.position ?? "");

      // locationCode: use zone/aisle/bay/level/position if available (matches dashboard display)
      // fallback to explicit API field, then raw barcode
      const locationCode = String(
        d.locationCode ?? d.code ??
        ([zoneName, aisleName, bayName, levelName, positionName].filter(Boolean).join(" / ") || raw)
      );
      // locationId: explicit field only (empty string is fine — Spider WMS uses locationCode)
      const locationId = String(d.locationId ?? d.id ?? "");

      const loc: LocationInfo = {
        locationCode,
        locationId,
        zoneName,
        aisleName,
        bayName,
        levelName,
        positionName,
      };

      rawScanRef.current = raw;
      locationRef.current = loc;
      // Persist to sessionStorage so re-mounts / stale closures can't lose it
      sessionStorage.setItem("stow_loc", JSON.stringify(loc));
      setLocation(loc);
      setLocScan("");
      setStep("confirm");
    } catch (e) {
      setLocError(e instanceof Error ? e.message : "Location scan failed");
    }
    setLocLoading(false);
  }

  // ── Assign ───────────────────────────────────────────────
  async function handleAssign() {
    // Use ref as source of truth — state may lag in closures
    const loc = locationRef.current ?? location;
    if (!tag || !loc) return;
    setAssigning(true);
    setAssignError("");
    try {
      // Normalize expireDate to YYYYMMDD (API requires no dashes)
      const expireDate = tag.expireDate?.replace(/-/g, "").slice(0, 8) ?? "";
      const wc = tag.warehouseCode || "STOO1";

      // Guarantee locationCode is never empty — use raw barcode as last resort
      const finalLocationCode = loc.locationCode || rawScanRef.current;
      const finalLocationId   = loc.locationId || "";

      const payload = {
        receiveOrderCode: tag.orderCode,
        receiveItemId: tag.receiveItemId,
        warehouseCode: wc,
        warehouseCd: tag.warehouseCd || wc,
        customerCode: tag.customerCode,
        productSku: tag.sku,
        lotNo: tag.lotNo ?? "",
        expireDate,
        itemCondition: tag.itemCondition ?? "GOOD",
        qty,
        locationCode: finalLocationCode,
        locationId: finalLocationId,
      };

      const res = await fetch("/api/wms/receiving/assign", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || json?.isSuccess === false || json?.success === false) {
        throw new Error(
          `${json?.message ?? json?.msg ?? `Assign failed (HTTP ${res.status})`}\n` +
          `loc: ${loc.locationCode} / id: ${loc.locationId}`
        );
      }

      // Mark stow tag as done in Redis
      if (tagId) {
        await fetch(`/api/stow-tags/${tagId}`, { method: "PATCH" });
      }

      setStep("done");
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : "Assign failed");
    }
    setAssigning(false);
  }

  // ── Loading ──────────────────────────────────────────────
  if (loadingTag) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={DARK}>
        <RefreshCw className="w-8 h-8 animate-spin text-slate-500" />
      </div>
    );
  }

  // ── Load error ───────────────────────────────────────────
  if (loadError || !tag) {
    return (
      <div className="min-h-screen flex flex-col" style={DARK}>
        <header className="px-5 py-4 flex items-center gap-3" style={HDR_BORDER}>
          <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <p className="text-base font-bold text-white">Stow</p>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
          <div className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)" }}>
            <AlertCircle className="w-8 h-8 text-red-400" />
          </div>
          <div className="text-center max-w-xs">
            <p className="text-white font-semibold mb-2">Load Failed</p>
            <p className="text-red-300 text-sm whitespace-pre-line">{loadError}</p>
          </div>
          <button onClick={() => router.back()}
            className="mt-4 px-6 py-3 rounded-xl text-sm font-semibold text-blue-300"
            style={GLASS}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  // ── Done ─────────────────────────────────────────────────
  if (step === "done") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6" style={DARK}>
        <div className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)" }}>
          <CheckCircle2 className="w-10 h-10 text-green-400" />
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-white mb-1">Stow Complete!</p>
          <p className="text-sm text-slate-400 font-mono">{tag.sku} × {qty}</p>
        </div>
        <div className="w-full rounded-2xl p-5 space-y-3" style={GLASS}>
          {[
            ["SKU", tag.sku],
            ["Qty Stowed", String(qty)],
            ["Location", location ? locLabel(location) : "-"],
            ...(tag.lotNo ? [["LOT", tag.lotNo]] : []),
            ...(tag.expireDate ? [["EXP", tag.expireDate.slice(0, 10)]] : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span className="text-slate-400">{k}</span>
              <span className={`font-mono font-semibold ${k === "Qty Stowed" ? "text-green-400" : "text-white"}`}>{v}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-3 w-full">
          <button
            onClick={() => router.replace("/inbound")}
            className="flex-1 flex items-center justify-center gap-2 h-14 rounded-2xl text-sm font-bold"
            style={{ background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)", color: "#93c5fd" }}
          >
            <RotateCcw className="w-4 h-4" /> Stow Another
          </button>
          <button
            onClick={() => router.replace("/home")}
            className="h-14 px-6 rounded-2xl text-sm font-bold text-slate-400"
            style={GLASS}
          >
            Home
          </button>
        </div>
      </div>
    );
  }

  // ── Main flow ─────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">Stow</p>
          <p className="text-xs text-slate-500 font-mono truncate">{tag.orderCode} · T{tag.tagNo}</p>
        </div>
      </header>

      <StepBar current={step} />

      <main className="flex-1 px-4 pt-4 pb-8 space-y-3 overflow-y-auto">
        {/* Item info (always visible) */}
        <div className="rounded-2xl p-4" style={GLASS}>
          <div className="flex items-center gap-2 mb-2">
            <Package className="w-4 h-4 text-green-400" />
            <p className="text-xs font-semibold text-green-300 uppercase tracking-wider">Item</p>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-base font-bold font-mono text-white">{tag.sku}</p>
              <p className="text-xs text-slate-400 mt-0.5 truncate">{tag.productName}</p>
              <div className="flex gap-3 mt-1 text-xs text-slate-500">
                {tag.lotNo && <span>LOT: {tag.lotNo}</span>}
                {tag.expireDate && <span>EXP: {tag.expireDate.slice(0, 10)}</span>}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs text-slate-500 mb-0.5">Tag Qty</p>
              <p className="text-xl font-bold text-white">{tag.qty}</p>
            </div>
          </div>
        </div>

        {/* ── QTY ── */}
        {step === "qty" && (
          <div className="rounded-2xl p-4 space-y-4"
            style={{ ...GLASS, border: "1px solid rgba(59,130,246,0.3)" }}>
            <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider">Enter Stow Quantity</p>
            <div className="flex items-center gap-3">
              <button onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-12 h-12 rounded-xl text-slate-300 text-2xl font-bold active:scale-95 transition-all"
                style={GLASS}>−</button>
              <input
                type="number" value={qty} min={1} max={tag.qty} autoFocus
                onChange={(e) => setQty(Math.min(tag.qty, Math.max(1, parseInt(e.target.value) || 1)))}
                className="flex-1 text-center text-3xl font-bold text-white outline-none rounded-xl py-3"
                style={INPUT_STYLE}
              />
              <button onClick={() => setQty((q) => Math.min(tag.qty, q + 1))}
                className="w-12 h-12 rounded-xl text-slate-300 text-2xl font-bold active:scale-95 transition-all"
                style={GLASS}>+</button>
            </div>
            <button
              onClick={() => { if (qty > 0) setStep("location"); }}
              className="w-full py-4 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
              style={{ background: "#3b82f6" }}
            >
              Next — Scan Location <MapPin className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── LOCATION ── */}
        {step === "location" && (
          <div className="rounded-2xl p-4 space-y-4"
            style={{ ...GLASS, border: "1px solid rgba(139,92,246,0.3)" }}>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-purple-400" />
              <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Scan Target Location</p>
            </div>
            {locError && (
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{locError}
              </div>
            )}
            <input
              ref={locRef} type="text" value={locScan}
              onChange={(e) => { setLocScan(e.target.value); setLocError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleLocationScan(); }}
              placeholder="Scan location barcode..."
              className="w-full text-center text-base font-mono text-white outline-none rounded-xl py-4"
              style={INPUT_STYLE}
            />
            <div className="flex gap-2">
              <button onClick={() => setStep("qty")}
                className="px-4 py-3.5 rounded-xl text-sm font-semibold text-slate-400 active:scale-95 transition-all"
                style={GLASS}>← Back</button>
              <button
                onClick={handleLocationScan}
                disabled={!locScan.trim() || locLoading}
                className="flex-1 py-3.5 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-40"
                style={{ background: "#7c3aed" }}
              >
                {locLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
                Confirm
              </button>
            </div>
          </div>
        )}

        {/* ── CONFIRM ── */}
        {step === "confirm" && (() => { const loc = locationRef.current ?? location; return loc ? (
          <div className="space-y-3">
            <div className="rounded-2xl p-4"
              style={{ ...GLASS, border: "1px solid rgba(139,92,246,0.3)" }}>
              <div className="flex items-center gap-2 mb-2">
                <MapPin className="w-4 h-4 text-purple-400" />
                <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Location</p>
              </div>
              <p className="text-xl font-bold font-mono text-white">{locLabel(loc)}</p>
              <p className="text-xs text-slate-500 mt-1 font-mono">code: {loc.locationCode}</p>
              <p className="text-xs text-slate-500 font-mono">id: {loc.locationId || "(empty)"}</p>
            </div>

            <div className="rounded-2xl p-4 space-y-3"
              style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <p className="text-xs font-semibold text-green-300 uppercase tracking-wider">Confirm Stow</p>
              </div>
              {[
                ["SKU", tag?.sku ?? ""],
                ["Qty", String(qty)],
                ["Location", locLabel(loc)],
                ...(tag?.lotNo ? [["LOT", tag.lotNo]] : []),
                ...(tag?.expireDate ? [["EXP", tag.expireDate.slice(0, 10)]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-slate-400">{k}</span>
                  <span className="font-mono font-semibold text-white">{v}</span>
                </div>
              ))}
            </div>

            {assignError && (
              <div className="flex items-start gap-1.5 text-xs text-red-400 px-1">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                <span className="whitespace-pre-line">{assignError}</span>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setStep("location")}
                className="px-4 py-4 rounded-xl text-sm font-semibold text-slate-400 active:scale-95 transition-all"
                style={GLASS}>← Back</button>
              <button
                onClick={handleAssign} disabled={assigning}
                className="flex-1 py-4 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50"
                style={{ background: "#16a34a" }}
              >
                {assigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {assigning ? "Assigning..." : "Confirm Stow"}
              </button>
            </div>
          </div>
        ) : null; })()}
      </main>
    </div>
  );
}

export default function StowPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" }}>
        <RefreshCw className="w-8 h-8 animate-spin text-slate-500" />
      </div>
    }>
      <StowFlowInner />
    </Suspense>
  );
}
