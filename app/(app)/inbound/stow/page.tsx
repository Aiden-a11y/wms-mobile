"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft, CheckCircle2, MapPin, Package, RefreshCw,
  ScanLine, AlertCircle, Loader2, RotateCcw,
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
const INPUT_STYLE = {
  background: "rgba(255,255,255,0.07)",
  border: "2px solid rgba(59,130,246,0.5)",
};

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
              <div className="flex-1 mx-1 h-px" style={{ background: done ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.1)" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StowFlowInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tagId = searchParams.get("id");
  const barcode = searchParams.get("barcode");

  const [loadingTag, setLoadingTag] = useState(true);
  const [tag, setTag] = useState<PersistedStowTag | null>(null);
  const [loadError, setLoadError] = useState("");

  const [step, setStep] = useState<Step>("qty");
  const [qty, setQty] = useState(0);
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const [locScan, setLocScan] = useState("");
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");

  const locRef = useRef<HTMLInputElement>(null);

  // ── Load tag from Redis ──────────────────────────────────
  useEffect(() => {
    async function fetchTag() {
      setLoadingTag(true);
      try {
        const res = await fetch("/api/stow-tags?pending=true");
        if (!res.ok) throw new Error("Failed to load tags");
        const all: PersistedStowTag[] = await res.json();

        let found: PersistedStowTag | undefined;
        if (tagId) {
          found = all.find((t) => String(t.id) === tagId);
        } else if (barcode) {
          found = all.find((t) => t.barcodeValue === barcode);
        }

        if (!found && barcode) {
          // Try WMS API fallback using the barcode value
          const raw = barcode;
          let orderCode = "";
          let itemId: number | null = null;
          if (raw.includes("::")) {
            const [a, b] = raw.split("::");
            orderCode = a.trim();
            itemId = parseInt(b.split("-")[0], 10);
          } else {
            orderCode = raw;
          }
          if (orderCode) {
            const r = await fetch(`/api/wms/receiving/items/${orderCode}`, { headers: authHeaders() });
            const j = await r.json().catch(() => null);
            const list: Record<string, unknown>[] =
              j?.data?.items ?? j?.data?.list ?? j?.data ?? [];
            const item = itemId != null
              ? list.find((x) => Number(x.receiveItemId ?? x.itemId) === itemId)
              : list[0];
            if (item) {
              // Build a synthetic tag so the flow works
              found = {
                id: Date.now(),
                tagNo: 1,
                orderCode,
                barcodeValue: barcode,
                qty: Number(item.orderQty ?? item.qty ?? 1),
                lotNo: String(item.lotNo ?? ""),
                expireDate: String(item.expireDate ?? ""),
                sku: String(item.productSku ?? item.sku ?? ""),
                productName: String(item.productName ?? ""),
                warehouseCode: String(item.warehouseCode ?? ""),
                warehouseCd: String(item.warehouseCd ?? item.warehouseId ?? ""),
                customerCode: String(item.customerCode ?? ""),
                receiveItemId: Number(item.receiveItemId ?? item.itemId ?? 0),
                itemCondition: String(item.itemCondition ?? "GOOD"),
              };
            }
          }
        }

        if (!found) { setLoadError("Stow tag not found."); setLoadingTag(false); return; }
        setTag(found);
        setQty(found.qty);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Failed to load tag");
      }
      setLoadingTag(false);
    }
    fetchTag();
  }, [tagId, barcode]); // eslint-disable-line

  useEffect(() => {
    if (step === "location") setTimeout(() => locRef.current?.focus(), 100);
  }, [step]);

  // ── Step: Location scan ──────────────────────────────────
  async function handleLocationScan() {
    const raw = locScan.trim();
    if (!raw || !tag) return;
    setLocLoading(true);
    setLocError("");
    try {
      const params = new URLSearchParams({ q: raw, warehouseCode: tag.warehouseCode });
      const res = await fetch(`/api/wms/warehouse/location-search?${params}`, { headers: authHeaders() });
      const json = await res.json().catch(() => null);

      let loc: LocationInfo | null = null;
      if (res.ok && json) {
        const d = (json?.data ?? json?.list?.[0] ?? json?.[0] ?? json) as Record<string, unknown>;
        if (d && (d.zoneName || d.locationCode)) {
          loc = {
            locationCode: String(d.locationCode ?? d.code ?? raw),
            locationId: String(d.locationId ?? d.id ?? ""),
            zoneName: String(d.zoneName ?? d.zone ?? ""),
            aisleName: String(d.aisleName ?? d.aisle ?? ""),
            bayName: String(d.bayName ?? d.bay ?? ""),
            levelName: String(d.levelName ?? d.level ?? ""),
            positionName: String(d.positionName ?? d.position ?? ""),
          };
        }
      }

      // Fallback: parse barcode like "01-A-03-02-01"
      if (!loc) {
        const parts = raw.split(/[-_/]/);
        if (parts.length >= 2) {
          loc = {
            locationCode: raw,
            locationId: "",
            zoneName: parts[0] ?? "",
            aisleName: parts[1] ?? "",
            bayName: parts[2] ?? "",
            levelName: parts[3] ?? "",
            positionName: parts[4] ?? "",
          };
        }
      }

      if (!loc) { setLocError("Location not found. Check the barcode."); setLocLoading(false); return; }
      setLocation(loc);
      setLocScan("");
      setStep("confirm");
    } catch (e) {
      setLocError(e instanceof Error ? e.message : "Location scan failed");
    }
    setLocLoading(false);
  }

  // ── Step: Assign ─────────────────────────────────────────
  async function handleAssign() {
    if (!tag || !location) return;
    setAssigning(true);
    setAssignError("");
    try {
      const payload = {
        receiveOrderCode: tag.orderCode,
        receiveItemId: tag.receiveItemId,
        warehouseCode: tag.warehouseCode,
        warehouseCd: tag.warehouseCd,
        customerCode: tag.customerCode,
        productSku: tag.sku,
        lotNo: tag.lotNo,
        expireDate: tag.expireDate,
        itemCondition: tag.itemCondition,
        qty,
        locationCode: location.locationCode,
        locationId: location.locationId,
      };

      const res = await fetch("/api/wms/receiving/assign", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok || json?.isSuccess === false) {
        throw new Error(json?.message ?? "Assign failed");
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

  // ── Location display helper ───────────────────────────────
  function locLabel(loc: LocationInfo) {
    return [loc.zoneName, loc.aisleName, loc.bayName, loc.levelName, loc.positionName]
      .filter(Boolean).join(" - ") || loc.locationCode;
  }

  // ── Loading / Error states ────────────────────────────────
  if (loadingTag) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={DARK}>
        <RefreshCw className="w-8 h-8 animate-spin text-slate-500" />
      </div>
    );
  }
  if (loadError || !tag) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6" style={DARK}>
        <AlertCircle className="w-10 h-10 text-red-400" />
        <p className="text-slate-300 text-sm text-center">{loadError || "Tag not found"}</p>
        <button onClick={() => router.back()} className="text-blue-400 text-sm">← Back</button>
      </div>
    );
  }

  // ── Done ──────────────────────────────────────────────────
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

        {/* Summary card */}
        <div className="w-full rounded-2xl p-5 space-y-3" style={GLASS}>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">SKU</span>
            <span className="font-mono font-bold text-white">{tag.sku}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Qty Stowed</span>
            <span className="font-bold text-green-400">{qty}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-400">Location</span>
            <span className="font-mono text-white">{location ? locLabel(location) : "-"}</span>
          </div>
          {tag.lotNo && (
            <div className="flex justify-between text-sm">
              <span className="text-slate-400">LOT</span>
              <span className="font-mono text-white">{tag.lotNo}</span>
            </div>
          )}
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
      {/* Header */}
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-white">Stow</p>
          <p className="text-xs text-slate-500 font-mono truncate">{tag.orderCode} · T{tag.tagNo}</p>
        </div>
      </header>

      {/* Step bar */}
      <StepBar current={step} />

      <main className="flex-1 px-4 pt-4 pb-8 space-y-3 overflow-y-auto">

        {/* Item info card (always visible) */}
        <div className="rounded-2xl p-4" style={GLASS}>
          <div className="flex items-center gap-2 mb-3">
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

        {/* ── STEP: QTY ── */}
        {step === "qty" && (
          <div className="rounded-2xl p-4 space-y-4" style={{ ...GLASS, border: "1px solid rgba(59,130,246,0.3)" }}>
            <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider">Enter Stow Quantity</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="w-12 h-12 rounded-xl text-slate-300 text-2xl font-bold active:scale-95 transition-all"
                style={GLASS}
              >−</button>
              <input
                type="number"
                value={qty}
                min={1}
                max={tag.qty}
                onChange={(e) => setQty(Math.min(tag.qty, Math.max(1, parseInt(e.target.value) || 1)))}
                autoFocus
                className="flex-1 text-center text-3xl font-bold text-white outline-none rounded-xl py-3"
                style={INPUT_STYLE}
              />
              <button
                onClick={() => setQty((q) => Math.min(tag.qty, q + 1))}
                className="w-12 h-12 rounded-xl text-slate-300 text-2xl font-bold active:scale-95 transition-all"
                style={GLASS}
              >+</button>
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

        {/* ── STEP: LOCATION ── */}
        {step === "location" && (
          <div className="rounded-2xl p-4 space-y-4" style={{ ...GLASS, border: "1px solid rgba(139,92,246,0.3)" }}>
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
              ref={locRef}
              type="text"
              value={locScan}
              onChange={(e) => { setLocScan(e.target.value); setLocError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleLocationScan(); }}
              placeholder="Scan location barcode..."
              className="w-full text-center text-base font-mono text-white outline-none rounded-xl py-4"
              style={INPUT_STYLE}
            />

            <div className="flex gap-2">
              <button
                onClick={() => setStep("qty")}
                className="px-4 py-3.5 rounded-xl text-sm font-semibold text-slate-400 active:scale-95 transition-all"
                style={GLASS}
              >← Back</button>
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

        {/* ── STEP: CONFIRM ── */}
        {step === "confirm" && location && (
          <div className="space-y-3">
            {/* Location card */}
            <div className="rounded-2xl p-4" style={{ ...GLASS, border: "1px solid rgba(139,92,246,0.3)" }}>
              <div className="flex items-center gap-2 mb-3">
                <MapPin className="w-4 h-4 text-purple-400" />
                <p className="text-xs font-semibold text-purple-300 uppercase tracking-wider">Location</p>
              </div>
              <p className="text-xl font-bold font-mono text-white">{locLabel(location)}</p>
              <p className="text-xs text-slate-500 mt-1 font-mono">{location.locationCode}</p>
            </div>

            {/* Summary */}
            <div className="rounded-2xl p-4 space-y-3" style={{ background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.25)" }}>
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <p className="text-xs font-semibold text-green-300 uppercase tracking-wider">Confirm Stow</p>
              </div>
              {[
                ["SKU", tag.sku],
                ["Qty", String(qty)],
                ["Location", locLabel(location)],
                ...(tag.lotNo ? [["LOT", tag.lotNo]] : []),
                ...(tag.expireDate ? [["EXP", tag.expireDate.slice(0, 10)]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <span className="text-slate-400">{k}</span>
                  <span className="font-mono font-semibold text-white">{v}</span>
                </div>
              ))}
            </div>

            {assignError && (
              <div className="flex items-center gap-1.5 text-xs text-red-400 px-1">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{assignError}
              </div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setStep("location")}
                className="px-4 py-4 rounded-xl text-sm font-semibold text-slate-400 active:scale-95 transition-all"
                style={GLASS}
              >← Back</button>
              <button
                onClick={handleAssign}
                disabled={assigning}
                className="flex-1 py-4 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-50"
                style={{ background: "#16a34a" }}
              >
                {assigning ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {assigning ? "Assigning..." : "Confirm Stow"}
              </button>
            </div>
          </div>
        )}
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
