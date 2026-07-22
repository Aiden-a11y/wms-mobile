"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, ScanLine, MapPin, Boxes,
  Loader2, AlertCircle, CheckCircle2, XCircle,
  ArrowRight, RotateCcw, ClipboardList, PlusCircle,
} from "lucide-react";
import { authHeaders } from "@/lib/api";
import { getAuth } from "@/lib/auth";

const WH = "STOO1";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" };
const INPUT_BLUE = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(59,130,246,0.5)" };

type Step = "location" | "product" | "count" | "recount" | "result_ok" | "result_mismatch";

interface LocInfo {
  locationCode: string;
  warehouseCd: string;
  zone: string; aisle: string; bay: string; level: string; position: string;
}

interface InventoryItem {
  sku: string;
  productName: string;
  systemQty: number;
  customerCode: string;
  lot: string;
  expireDate: string;
}

/* ── helpers ────────────────────────────────────────────────── */
const normLoc = (s: string) => String(s).toLowerCase().replace(/[\s\-_/]+/g, "");
const pad2 = (s: unknown) => String(s ?? "").trim().padStart(2, "0");

function arrOf(json: unknown): Record<string, unknown>[] {
  const j = json as Record<string, unknown>;
  const d = (j?.data ?? j) as Record<string, unknown>;
  if (Array.isArray((d as { list?: unknown })?.list)) return (d as { list: Record<string, unknown>[] }).list;
  if (Array.isArray(d)) return d as unknown as Record<string, unknown>[];
  if (Array.isArray((j as { list?: unknown })?.list)) return (j as { list: Record<string, unknown>[] }).list;
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  return [];
}

function locKey(r: Record<string, unknown>): string {
  return [
    r.zoneName ?? r.zone ?? r.zoneCode,
    r.aisleName ?? r.aisle ?? r.aisleCode,
    r.bayName ?? r.bay ?? r.bayCode,
    r.levelName ?? r.level ?? r.levelCode,
    r.positionName ?? r.position ?? r.positionCode,
  ].map(pad2).join("");
}
function buildLocCode(r: Record<string, unknown>): string {
  const parts = [
    r.zoneName ?? r.zone ?? r.zoneCode,
    r.aisleName ?? r.aisle ?? r.aisleCode,
    r.bayName ?? r.bay ?? r.bayCode,
    r.levelName ?? r.level ?? r.levelCode,
    r.positionName ?? r.position ?? r.positionCode,
  ].map((v) => String(v ?? "")).filter(Boolean);
  return String(r.locationCode ?? (parts.length ? parts.join("-") : ""));
}

async function fetchCustomers(): Promise<string[]> {
  try {
    const r = await fetch(`/api/wms/combo/customer-by-warehouse/${WH}`, { headers: authHeaders() });
    const arr = arrOf(await r.json());
    return arr.map((c) => String(c.code ?? c.customerCode ?? c.id ?? "")).filter(Boolean);
  } catch { return []; }
}

async function fetchInventoryAtLocation(
  locInfo: LocInfo,
  sku: string,
): Promise<InventoryItem | null> {
  const fromKey = locKey({
    zone: locInfo.zone, aisle: locInfo.aisle,
    bay: locInfo.bay, level: locInfo.level, position: locInfo.position,
  });
  const fromNorm = normLoc(locInfo.locationCode);
  const matchLoc = (r: Record<string, unknown>) =>
    (fromKey.replace(/0/g, "") !== "" && locKey(r) === fromKey) ||
    (fromNorm !== "" && normLoc(buildLocCode(r)) === fromNorm);

  const custs = await fetchCustomers();
  const targets = custs.length ? custs : [""];

  let totalQty = 0;
  let customerCode = "";
  let productName = "";
  let lot = "";
  let expireDate = "";
  let found = false;

  for (const c of targets) {
    try {
      const res = await fetch("/api/wms/inventory/detail", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ warehouseCode: WH, customerCode: c || undefined, productSku: sku }),
      });
      if (!res.ok) continue;
      const rows = arrOf(await res.json()).filter(matchLoc);
      for (const r of rows) {
        const qty = Number(r.qty ?? r.quantity ?? r.stockQty ?? r.onHandQty ?? 0);
        if (qty <= 0) continue;
        totalQty += qty;
        if (!found) {
          found = true;
          customerCode = String(r.customerCode ?? c ?? "");
          productName = String(r.productName ?? r.itemName ?? "");
          lot = String(r.lotNo ?? r.lot ?? "");
          expireDate = String(r.expireDate ?? r.expiryDate ?? "");
        }
      }
    } catch { /* silent */ }
  }

  if (!found) return null;
  return { sku, productName, systemQty: totalQty, customerCode, lot, expireDate };
}

/* ── component ───────────────────────────────────────────────── */
export default function CycleCountPage() {
  const router = useRouter();
  const [sessionId] = useState(() => crypto.randomUUID());
  const [step, setStep] = useState<Step>("location");
  const [countsDone, setCountsDone] = useState(0);

  /* location */
  const [locScan, setLocScan] = useState("");
  const [locInfo, setLocInfo] = useState<LocInfo | null>(null);
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState("");

  /* product */
  const [skuScan, setSkuScan] = useState("");
  const [skuLoading, setSkuLoading] = useState(false);
  const [skuError, setSkuError] = useState("");
  const [currentItem, setCurrentItem] = useState<InventoryItem | null>(null);

  /* count */
  const [countInput, setCountInput] = useState("");
  const [recountInput, setRecountInput] = useState("");
  const [finalQty, setFinalQty] = useState(0);
  const [saving, setSaving] = useState(false);

  const locRef = useRef<HTMLInputElement>(null);
  const skuRef = useRef<HTMLInputElement>(null);
  const countRef = useRef<HTMLInputElement>(null);
  const recountRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (step === "location") setTimeout(() => locRef.current?.focus(), 100); }, [step]);
  useEffect(() => { if (step === "product") setTimeout(() => skuRef.current?.focus(), 100); }, [step]);
  useEffect(() => { if (step === "count") setTimeout(() => countRef.current?.focus(), 100); }, [step]);
  useEffect(() => { if (step === "recount") setTimeout(() => recountRef.current?.focus(), 100); }, [step]);

  /* ── STEP 1: scan location ── */
  async function handleLocScan() {
    const raw = locScan.trim();
    if (!raw) return;
    setLocLoading(true); setLocError("");
    try {
      const res = await fetch("/api/wms/warehouse/location-search", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ search: raw, warehouseCode: WH }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(`Location API ${res.status}`);
      const dRaw = (json as { data?: unknown })?.data;
      const d = (Array.isArray(dRaw) ? dRaw[0] : dRaw) as Record<string, unknown> | null;
      if (!d) { setLocError(`Location "${raw}" not found.`); setLocLoading(false); return; }

      const zone = String(d.zoneName ?? d.zone ?? "");
      const aisle = String(d.aisleName ?? d.aisle ?? "");
      const bay = String(d.bayName ?? d.bay ?? "");
      const level = String(d.levelName ?? d.level ?? "");
      const position = String(d.positionName ?? d.position ?? "");
      const locationCode = buildLocCode(d) || raw;
      const warehouseCd = String(d.warehouseCd ?? "");

      setLocInfo({ locationCode, warehouseCd, zone, aisle, bay, level, position });
      setLocScan("");
      setSkuScan(""); setSkuError(""); setCurrentItem(null);
      setStep("product");
    } catch (e) {
      setLocError(e instanceof Error ? e.message : "Scan failed");
    }
    setLocLoading(false);
  }

  /* ── STEP 2: scan product ── */
  async function handleSkuScan() {
    const sku = skuScan.trim();
    if (!sku || !locInfo) return;
    setSkuLoading(true); setSkuError("");
    try {
      const item = await fetchInventoryAtLocation(locInfo, sku);
      if (!item) {
        setSkuError(`SKU "${sku}" not found at ${locInfo.locationCode}.`);
        setSkuLoading(false); return;
      }
      setCurrentItem(item);
      setSkuScan("");
      setCountInput("");
      setStep("count");
    } catch (e) {
      setSkuError(e instanceof Error ? e.message : "Lookup failed");
    }
    setSkuLoading(false);
  }

  /* ── Add item not in system (ghost item, system_qty=0) ── */
  function handleAddItem() {
    const sku = skuScan.trim();
    if (!sku) return;
    setCurrentItem({ sku, productName: "", systemQty: 0, customerCode: "", lot: "", expireDate: "" });
    setSkuError("");
    setCountInput("");
    setStep("count");
  }

  /* ── STEP 3: first count ── */
  function handleCount() {
    const n = parseInt(countInput);
    if (isNaN(n) || n < 0) return;
    if (!currentItem) return;
    const isGhost = currentItem.systemQty === 0 && currentItem.productName === "";
    if (isGhost) {
      // not-in-system item: save immediately (OVER if >0, OK if 0)
      setFinalQty(n);
      saveRecord(n, n > 0 ? "OVER" : "OK");
    } else if (n === currentItem.systemQty) {
      setFinalQty(n);
      saveRecord(n, "OK");
    } else {
      setStep("recount");
    }
  }

  /* ── STEP 4: second count ── */
  function handleRecount() {
    const n = parseInt(recountInput);
    if (isNaN(n) || n < 0) return;
    setFinalQty(n);
    if (!currentItem) return;
    const status = n > currentItem.systemQty ? "OVER" : "SHORT";
    saveRecord(n, status);
  }

  /* ── Save to Supabase via API ── */
  async function saveRecord(countedQty: number, status: "OK" | "OVER" | "SHORT") {
    if (!currentItem || !locInfo) return;
    setSaving(true);
    const auth = getAuth();
    try {
      await fetch("/api/cycle-count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          warehouse_code: WH,
          customer_code: currentItem.customerCode || null,
          location: locInfo.locationCode,
          sku: currentItem.sku,
          product_name: currentItem.productName || null,
          lot: currentItem.lot || null,
          expire_date: currentItem.expireDate || null,
          system_qty: currentItem.systemQty,
          counted_qty: countedQty,
          status,
          counted_by: auth?.userId ?? "unknown",
        }),
      });
    } catch { /* silent — continue even if save fails */ }
    setSaving(false);
    setCountsDone((n) => n + 1);
    if (status === "OK") {
      setStep("result_ok");
    } else {
      setStep("result_mismatch");
    }
  }

  /* ── Navigation ── */
  function nextItem() {
    setSkuScan(""); setSkuError(""); setCurrentItem(null);
    setCountInput(""); setRecountInput("");
    setStep("product");
  }
  function nextLocation() {
    setLocScan(""); setLocInfo(null); setLocError("");
    setSkuScan(""); setSkuError(""); setCurrentItem(null);
    setCountInput(""); setRecountInput("");
    setStep("location");
  }
  function back() {
    if (step === "location") router.back();
    else if (step === "product") nextLocation();
    else if (step === "count") { setStep("product"); setCurrentItem(null); setSkuScan(""); }
    else if (step === "recount") { setCountInput(""); setStep("count"); }
    else if (step === "result_ok" || step === "result_mismatch") nextItem();
  }

  const stepLabel: Record<Step, string> = {
    location: "Step 1 · Scan location",
    product: "Step 2 · Scan product",
    count: "Step 3 · Count quantity",
    recount: "Step 3 · Count again",
    result_ok: "Match!",
    result_mismatch: "Discrepancy recorded",
  };

  /* ── UI ─────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR}>
        <button onClick={back} className="p-1 text-slate-400 active:text-white transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-base font-bold text-white">Cycle Count</p>
          <p className="text-[11px] text-slate-400">{stepLabel[step]}</p>
        </div>
        {countsDone > 0 && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(16,185,129,0.15)" }}>
            <ClipboardList className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-xs font-bold text-emerald-400">{countsDone}</span>
          </div>
        )}
      </header>

      <main className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">

        {/* Location info bar (visible in steps after location) */}
        {locInfo && step !== "location" && (
          <div className="rounded-xl px-4 py-3 flex items-center gap-2" style={GLASS}>
            <MapPin className="w-4 h-4 text-blue-300 flex-shrink-0" />
            <span className="font-mono text-sm text-white truncate">{locInfo.locationCode}</span>
            <button
              onClick={nextLocation}
              className="ml-auto text-[10px] font-semibold text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap"
            >
              Change
            </button>
          </div>
        )}

        {/* ── STEP 1: Location scan ── */}
        {step === "location" && (
          <>
            <div className="rounded-2xl p-5" style={GLASS}>
              <div className="flex items-center gap-2 mb-3" style={{ color: "#60a5fa" }}>
                <MapPin className="w-5 h-5" />
                <span className="text-sm font-semibold">Location</span>
              </div>
              <input
                ref={locRef}
                value={locScan}
                onChange={(e) => setLocScan(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLocScan()}
                placeholder="Scan or type location barcode"
                autoComplete="off"
                className="w-full rounded-xl px-4 py-3 text-white text-base outline-none placeholder:text-slate-500"
                style={INPUT_BLUE}
              />
              <button
                onClick={handleLocScan}
                disabled={locLoading || !locScan.trim()}
                className="mt-3 w-full rounded-xl py-3 font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "#2563eb" }}
              >
                {locLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ScanLine className="w-5 h-5" />}
                Confirm location
              </button>
            </div>
            {locError && <ErrBox msg={locError} />}
          </>
        )}

        {/* ── STEP 2: Product scan ── */}
        {step === "product" && (
          <>
            <div className="rounded-2xl p-5" style={GLASS}>
              <div className="flex items-center gap-2 mb-3" style={{ color: "#60a5fa" }}>
                <ScanLine className="w-5 h-5" />
                <span className="text-sm font-semibold">Product</span>
              </div>
              <input
                ref={skuRef}
                value={skuScan}
                onChange={(e) => setSkuScan(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSkuScan()}
                placeholder="Scan product barcode"
                autoComplete="off"
                className="w-full rounded-xl px-4 py-3 text-white text-base outline-none placeholder:text-slate-500"
                style={INPUT_BLUE}
              />
              <button
                onClick={handleSkuScan}
                disabled={skuLoading || !skuScan.trim()}
                className="mt-3 w-full rounded-xl py-3 font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "#2563eb" }}
              >
                {skuLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                {skuLoading ? "Looking up…" : "Confirm product"}
              </button>
            </div>
            {skuError && (
              <>
                <ErrBox msg={skuError} />
                {skuError.includes("not found") && (
                  <button
                    onClick={handleAddItem}
                    className="w-full rounded-xl py-3 font-semibold flex items-center justify-center gap-2"
                    style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.35)" }}
                  >
                    <PlusCircle className="w-5 h-5 text-emerald-400" />
                    <span className="text-emerald-300">Add Item (not in system)</span>
                  </button>
                )}
              </>
            )}
          </>
        )}

        {/* ── STEP 3: Count (first attempt) ── */}
        {step === "count" && (
          <>
            {currentItem?.systemQty === 0 && currentItem?.productName === "" && (
              <div className="rounded-xl px-4 py-3 flex gap-2.5" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)" }}>
                <PlusCircle className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-emerald-300">
                  <span className="font-semibold">New item</span> — not in system. Count what&apos;s physically here and it will be recorded as OVER for manager review.
                </p>
              </div>
            )}
            <div className="rounded-2xl p-5" style={GLASS}>
              <div className="flex items-center gap-2 mb-4">
                <Boxes className="w-5 h-5 text-blue-300" />
                <span className="text-sm font-semibold text-white">Count the quantity</span>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Count all units of this product at this location and enter the total below.
              </p>
              <input
                ref={countRef}
                type="number"
                inputMode="numeric"
                value={countInput}
                onChange={(e) => setCountInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCount()}
                placeholder="0"
                className="w-full rounded-xl px-4 py-4 text-white text-3xl font-black text-center outline-none placeholder:text-slate-600"
                style={INPUT_BLUE}
                min="0"
              />
              <button
                onClick={handleCount}
                disabled={saving || countInput === "" || parseInt(countInput) < 0 || isNaN(parseInt(countInput))}
                className="mt-4 w-full rounded-xl py-3 font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "#2563eb" }}
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                Submit count
              </button>
            </div>
          </>
        )}

        {/* ── STEP 4: Recount ── */}
        {step === "recount" && (
          <>
            <div className="rounded-2xl p-5" style={{ background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)" }}>
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-5 h-5 text-amber-400" />
                <span className="text-sm font-semibold text-amber-300">Count mismatch</span>
              </div>
              <p className="text-xs text-slate-300">Please count again carefully and enter the total.</p>
            </div>
            <div className="rounded-2xl p-5" style={GLASS}>
              <div className="flex items-center gap-2 mb-4">
                <Boxes className="w-5 h-5 text-amber-300" />
                <span className="text-sm font-semibold text-white">Recount quantity</span>
              </div>
              <input
                ref={recountRef}
                type="number"
                inputMode="numeric"
                value={recountInput}
                onChange={(e) => setRecountInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRecount()}
                placeholder="0"
                className="w-full rounded-xl px-4 py-4 text-white text-3xl font-black text-center outline-none placeholder:text-slate-600"
                style={{ background: "rgba(255,255,255,0.07)", border: "2px solid rgba(251,191,36,0.5)" }}
                min="0"
              />
              <button
                onClick={handleRecount}
                disabled={saving || recountInput === "" || parseInt(recountInput) < 0 || isNaN(parseInt(recountInput))}
                className="mt-4 w-full rounded-xl py-3 font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "#d97706" }}
              >
                {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                Submit final count
              </button>
            </div>
          </>
        )}

        {/* ── RESULT: OK ── */}
        {step === "result_ok" && (
          <>
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "rgba(16,185,129,0.15)", border: "2px solid rgba(16,185,129,0.5)" }}>
                <CheckCircle2 className="w-9 h-9 text-emerald-400" />
              </div>
              <p className="text-lg font-bold text-emerald-400">Count Matches</p>
              <p className="text-sm text-slate-400">Quantity verified — no discrepancy.</p>
            </div>
            <ResultSummary item={currentItem} loc={locInfo} counted={finalQty} />
            <div className="flex flex-col gap-3">
              <button onClick={nextItem} className="w-full rounded-xl py-3 font-semibold text-white flex items-center justify-center gap-2" style={{ background: "#2563eb" }}>
                <ScanLine className="w-5 h-5" /> Next Item at This Location
              </button>
              <button onClick={nextLocation} className="w-full rounded-xl py-3 font-semibold flex items-center justify-center gap-2" style={GLASS}>
                <MapPin className="w-5 h-5 text-slate-300" />
                <span className="text-slate-300">Next Location</span>
              </button>
            </div>
          </>
        )}

        {/* ── RESULT: Mismatch ── */}
        {step === "result_mismatch" && currentItem && (
          <>
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="w-16 h-16 rounded-full flex items-center justify-center"
                style={{ background: "rgba(239,68,68,0.15)", border: "2px solid rgba(239,68,68,0.5)" }}>
                <XCircle className="w-9 h-9 text-red-400" />
              </div>
              <p className="text-lg font-bold text-red-400">
                {finalQty > currentItem.systemQty ? "OVER" : "SHORT"}
              </p>
              <p className="text-sm text-slate-400">
                Difference:{" "}
                <span className={finalQty > currentItem.systemQty ? "text-blue-400 font-bold" : "text-red-400 font-bold"}>
                  {finalQty > currentItem.systemQty ? "+" : ""}{finalQty - currentItem.systemQty}
                </span>
                {" "}units
              </p>
              <p className="text-xs text-slate-500">Discrepancy saved. A manager will review.</p>
            </div>
            <ResultSummary item={currentItem} loc={locInfo} counted={finalQty} showSystem />
            <div className="flex flex-col gap-3">
              <button onClick={nextItem} className="w-full rounded-xl py-3 font-semibold text-white flex items-center justify-center gap-2" style={{ background: "#2563eb" }}>
                <ScanLine className="w-5 h-5" /> Next Item at This Location
              </button>
              <button onClick={nextLocation} className="w-full rounded-xl py-3 font-semibold flex items-center justify-center gap-2" style={GLASS}>
                <MapPin className="w-5 h-5 text-slate-300" />
                <span className="text-slate-300">Next Location</span>
              </button>
              <button onClick={() => { setCountsDone(0); nextLocation(); }} className="w-full rounded-xl py-3 font-semibold flex items-center justify-center gap-2 text-slate-500">
                <RotateCcw className="w-4 h-4" /> End Session
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/* ── sub-components ─────────────────────────────────────────── */
function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl p-3.5 flex gap-2.5" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
      <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
      <p className="text-xs text-red-200 whitespace-pre-wrap leading-relaxed">{msg}</p>
    </div>
  );
}

function ResultSummary({ item, loc, counted, showSystem }: {
  item: InventoryItem | null;
  loc: LocInfo | null;
  counted: number;
  showSystem?: boolean;
}) {
  if (!item || !loc) return null;
  return (
    <div className="rounded-2xl p-4 space-y-1.5" style={GLASS}>
      <Row k="Location" v={loc.locationCode} mono />
      <Row k="SKU" v={item.sku} mono />
      {item.lot && <Row k="LOT" v={item.lot} />}
      {item.expireDate && <Row k="EXP" v={item.expireDate} />}
      <Row k="Counted" v={String(counted)} />
      {showSystem && <Row k="System" v={String(item.systemQty)} />}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between py-1 text-sm border-b last:border-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      <span className="text-slate-400">{k}</span>
      <span className={`text-white font-semibold ${mono ? "font-mono" : ""}`}>{v}</span>
    </div>
  );
}
