"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, ScanLine, MapPin, Package, Boxes,
  Loader2, AlertCircle, CheckCircle2, ArrowRight, RotateCcw,
} from "lucide-react";
import { authHeaders } from "@/lib/api";

const WH = "STOO1";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" };
const INPUT = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(59,130,246,0.5)" };

type Step = "from" | "pick" | "to" | "done";

interface LocInfo {
  locationCode: string;
  warehouseCd: string;
  zone: string; aisle: string; bay: string; level: string; position: string;
}
interface Stock {
  productSku: string;
  productName: string;
  qty: number;
  lotNo: string;
  expireDate: string;
  itemCondition: string;
  customerCode: string;
}

/* ── helpers ──────────────────────────────────────────── */
const normLoc = (s: string) => String(s).toLowerCase().replace(/[\s\-_/]+/g, "");

function arrOf(json: unknown): Record<string, unknown>[] {
  const j = json as Record<string, unknown>;
  const d = (j?.data ?? j) as Record<string, unknown>;
  if (Array.isArray((d as { list?: unknown })?.list)) return (d as { list: Record<string, unknown>[] }).list;
  if (Array.isArray(d)) return d as unknown as Record<string, unknown>[];
  if (Array.isArray((j as { list?: unknown })?.list)) return (j as { list: Record<string, unknown>[] }).list;
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  return [];
}

const pad2 = (s: unknown) => String(s ?? "").trim().padStart(2, "0");
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

function toStock(r: Record<string, unknown>): Stock {
  return {
    productSku: String(r.productSku ?? r.sku ?? r.itemCode ?? ""),
    productName: String(r.productName ?? r.itemName ?? ""),
    qty: Number(r.qty ?? r.quantity ?? r.stockQty ?? r.onHandQty ?? 0),
    lotNo: String(r.lotNo ?? r.lot ?? ""),
    expireDate: String(r.expireDate ?? r.expiryDate ?? ""),
    itemCondition: String(r.itemCondition ?? r.condition ?? r.conditionCode ?? r.status ?? "GOOD"),
    customerCode: String(r.customerCode ?? ""),
  };
}

async function detail(body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  return wmsList("inventory/detail", body);
}

async function wmsList(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(`/api/wms/${path}`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    return arrOf(await res.json());
  } catch { return []; }
}

/* Load ALL stock for the warehouse (per-customer paginated bulk — proven dashboard method). */
async function loadAllStock(): Promise<Record<string, unknown>[]> {
  const custs = await fetchCustomers();
  const targets: (string | undefined)[] = custs.length ? custs : [undefined];
  for (const ep of ["inventory/detail", "inventory/list"]) {
    const acc: Record<string, unknown>[] = [];
    let worked = false;
    for (const c of targets) {
      let page = 1;
      while (true) {
        const rows = await wmsList(ep, { warehouseCode: WH, customerCode: c || undefined, pageNum: page, pageSize: 500 });
        if (rows.length === 0) break;
        worked = true;
        const skuSet = new Set(rows.map((r) => String(r.productSku ?? r.sku ?? "")));
        acc.push(...rows);
        if (skuSet.size < 2 && rows.length > 5) break; // looks like single-SKU detail, not a bulk list
        if (rows.length < 500) break;
        page++;
      }
    }
    if (worked && acc.length) return acc;
  }
  return [];
}

async function fetchCustomers(): Promise<string[]> {
  try {
    const r = await fetch(`/api/wms/combo/customer-by-warehouse/${WH}`, { headers: authHeaders() });
    const arr = arrOf(await r.json());
    return arr.map((c) => String(c.code ?? c.customerCode ?? c.id ?? "")).filter(Boolean);
  } catch { return []; }
}

/* ── component ────────────────────────────────────────── */
export default function InventoryMovePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("from");

  const [fromScan, setFromScan] = useState("");
  const [fromLoc, setFromLoc] = useState<LocInfo | null>(null);
  const [fromLoading, setFromLoading] = useState(false);
  const [fromError, setFromError] = useState("");

  const [stock, setStock] = useState<Stock[] | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockMethod, setStockMethod] = useState("");

  const [sel, setSel] = useState<Stock | null>(null);
  const [qty, setQty] = useState(1);

  const [toScan, setToScan] = useState("");
  const [toLoading, setToLoading] = useState(false);
  const [toError, setToError] = useState("");
  const [moving, setMoving] = useState(false);

  const [result, setResult] = useState<{ from: string; to: string; sku: string; qty: number } | null>(null);

  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (step === "from") setTimeout(() => fromRef.current?.focus(), 100); }, [step]);
  useEffect(() => { if (step === "to") setTimeout(() => toRef.current?.focus(), 100); }, [step]);

  /* resolve a scanned barcode → LocInfo via location-search */
  async function searchLocation(raw: string): Promise<LocInfo | null> {
    const res = await fetch("/api/wms/warehouse/location-search", {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ search: raw, warehouseCode: WH }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Location API ${res.status}: ${(json as { message?: string })?.message ?? "error"}`);
    const dRaw = (json as { data?: unknown })?.data;
    const d = (Array.isArray(dRaw) ? dRaw[0] : dRaw) as Record<string, unknown> | null;
    if (!d) return null;
    const zone = String(d.zoneName ?? d.zone ?? "");
    const aisle = String(d.aisleName ?? d.aisle ?? "");
    const bay = String(d.bayName ?? d.bay ?? "");
    const level = String(d.levelName ?? d.level ?? "");
    const position = String(d.positionName ?? d.position ?? "");
    const locationCode = buildLocCode(d) || raw;
    const warehouseCd = d.warehouseCd != null ? String(d.warehouseCd) : "";
    return { locationCode, warehouseCd, zone, aisle, bay, level, position };
  }

  /* ── STEP 1: FROM scan ── */
  async function handleFromScan() {
    const raw = fromScan.trim();
    if (!raw) return;
    setFromLoading(true); setFromError("");
    try {
      const loc = await searchLocation(raw);
      if (!loc) { setFromError(`Location "${raw}" not found.`); setFromLoading(false); return; }
      if (!loc.warehouseCd) { setFromError(`Location "${raw}" has no warehouseCd.`); setFromLoading(false); return; }
      setFromLoc(loc);
      setFromScan("");
      setStep("pick");
      loadStock(loc);
    } catch (e) {
      setFromError(e instanceof Error ? e.message : "Scan failed");
    }
    setFromLoading(false);
  }

  /* ── STEP 2: load stock at FROM location ── */
  async function loadStock(loc: LocInfo) {
    setStock(null); setStockLoading(true); setStockMethod("");

    // location matching: zero-padded parts (handles "1" vs "01"), or normalized full code
    const fromKey = locKey({ zone: loc.zone, aisle: loc.aisle, bay: loc.bay, level: loc.level, position: loc.position });
    const fromNorm = normLoc(loc.locationCode);
    const match = (r: Record<string, unknown>) =>
      (fromKey.replace(/0/g, "") !== "" && locKey(r) === fromKey) ||
      (fromNorm !== "" && normLoc(buildLocCode(r)) === fromNorm);

    let rows: Record<string, unknown>[] = [];
    let method = "";

    // (B) light path first: single location-only call
    const light = (await detail({ warehouseCode: WH, locationCode: loc.locationCode })).filter(match);
    if (light.length) { rows = light; method = "location-only"; }

    // (A) fallback: bulk load all stock + client-side location filter (dashboard method)
    if (rows.length === 0) {
      const all = await loadAllStock();
      rows = all.filter(match);
      method = `bulk ${all.length} rows · ${rows.length} here`;
    }

    // de-dup by sku|lot|exp|condition
    const seen = new Map<string, Stock>();
    for (const r of rows) {
      const s = toStock(r);
      if (!s.productSku || s.qty <= 0) continue;
      const k = `${s.productSku}|${s.lotNo}|${s.expireDate}|${s.itemCondition}`;
      if (!seen.has(k)) seen.set(k, s);
    }
    setStock([...seen.values()]);
    setStockMethod(method);
    setStockLoading(false);
  }

  function pickStock(s: Stock) {
    setSel(s);
    setQty(1);
  }

  /* ── STEP 3: TO scan + move ── */
  async function handleToScan() {
    const raw = toScan.trim();
    if (!raw || !sel || !fromLoc) return;
    setToLoading(true); setToError("");
    try {
      const loc = await searchLocation(raw);
      if (!loc) { setToError(`Location "${raw}" not found.`); setToLoading(false); return; }
      if (!loc.warehouseCd) { setToError(`Location "${raw}" has no warehouseCd.`); setToLoading(false); return; }
      if (normLoc(loc.locationCode) === normLoc(fromLoc.locationCode)) {
        setToError("TO location is the same as FROM. Scan a different location.");
        setToLoading(false); return;
      }
      await submitMove(loc);
    } catch (e) {
      setToError(e instanceof Error ? e.message : "Scan failed");
      setToLoading(false);
    }
  }

  async function submitMove(toLoc: LocInfo) {
    if (!sel || !fromLoc) return;
    setMoving(true); setToError("");
    const exp = (sel.expireDate || "").replace(/-/g, "").slice(0, 8);
    const payload = {
      customerCode: sel.customerCode,
      warehouseCode: WH,
      productSku: sel.productSku,
      fromWarehouseCd: fromLoc.warehouseCd,
      lotNo: sel.lotNo || "",
      expireDate: exp,
      itemCondition: sel.itemCondition || "GOOD",
      moveQty: qty,
      remark: "",
      serialNo: "",
      toWarehouseCd: toLoc.warehouseCd,
      toLotNo: sel.lotNo || "",
      toExpireDate: exp,
      toItemCondition: sel.itemCondition || "GOOD",
    };
    try {
      const res = await fetch("/api/wms/inventory/move", {
        method: "POST", headers: authHeaders(), body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok || json?.isSuccess === false || json?.success === false) {
        throw new Error(String(json?.message ?? json?.msg ?? `Move failed (HTTP ${res.status})`));
      }
      setResult({ from: fromLoc.locationCode, to: toLoc.locationCode, sku: sel.productSku, qty });
      setStep("done");
    } catch (e) {
      setToError(e instanceof Error ? e.message : "Move failed");
    }
    setMoving(false);
  }

  function reset() {
    setStep("from"); setFromScan(""); setFromLoc(null); setFromError("");
    setStock(null); setSel(null); setQty(1); setToScan(""); setToError(""); setResult(null);
  }

  /* ── UI ─────────────────────────────────────────────── */
  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR}>
        <button
          onClick={() => (step === "from" ? router.back() : step === "pick" ? reset() : setStep("pick"))}
          className="p-1 text-slate-400 active:text-white transition-colors"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-base font-bold text-white">Simple Move</p>
          <p className="text-[11px] text-slate-400">
            {step === "from" && "Step 1 · Scan FROM location"}
            {step === "pick" && "Step 2 · Select item & qty"}
            {step === "to" && "Step 3 · Scan TO location"}
            {step === "done" && "Done"}
          </p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-5">
        {/* STEP 1 — FROM SCAN */}
        {step === "from" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl p-5" style={GLASS}>
              <div className="flex items-center gap-2 mb-3 text-blue-300">
                <ScanLine className="w-5 h-5" />
                <span className="text-sm font-semibold">FROM Location</span>
              </div>
              <input
                ref={fromRef}
                value={fromScan}
                onChange={(e) => setFromScan(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleFromScan()}
                placeholder="Scan or type location barcode"
                className="w-full rounded-xl px-4 py-3 text-white text-base outline-none placeholder:text-slate-500"
                style={INPUT}
                autoComplete="off"
              />
              <button
                onClick={handleFromScan}
                disabled={fromLoading || !fromScan.trim()}
                className="mt-3 w-full rounded-xl py-3 font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "#2563eb" }}
              >
                {fromLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                Load items here
              </button>
            </div>
            {fromError && <ErrorBox msg={fromError} />}
          </div>
        )}

        {/* STEP 2 — PICK ITEM + QTY */}
        {step === "pick" && fromLoc && (
          <div className="flex flex-col gap-4">
            <LocCard label="FROM" loc={fromLoc} />

            {stockLoading && (
              <div className="flex flex-col items-center gap-3 py-10 text-slate-400">
                <Loader2 className="w-7 h-7 animate-spin" />
                <p className="text-sm">Loading items at this location…</p>
              </div>
            )}

            {!stockLoading && stock && stock.length === 0 && (
              <div className="rounded-2xl p-6 text-center" style={GLASS}>
                <Boxes className="w-9 h-9 text-slate-500 mx-auto mb-2" />
                <p className="text-sm text-slate-300 font-semibold">No stock at this location</p>
                <button onClick={reset} className="mt-3 text-xs text-blue-300 underline">Scan another location</button>
              </div>
            )}

            {!stockLoading && stock && stock.length > 0 && (
              <>
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs font-semibold text-slate-400">{stock.length} item(s)</span>
                  {stockMethod && <span className="text-[10px] text-slate-600">via {stockMethod}</span>}
                </div>
                <div className="flex flex-col gap-2">
                  {stock.map((s, i) => {
                    const on = sel === s;
                    return (
                      <button
                        key={i}
                        onClick={() => pickStock(s)}
                        className="text-left rounded-xl p-3.5 transition-colors"
                        style={{ ...GLASS, borderColor: on ? "rgba(59,130,246,0.8)" : "rgba(255,255,255,0.08)", background: on ? "rgba(37,99,235,0.18)" : (GLASS.background as string) }}
                      >
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-blue-300 flex-shrink-0" />
                          <span className="font-mono text-sm font-semibold text-white flex-1 truncate">{s.productSku}</span>
                          <span className="text-sm font-bold text-white">{s.qty}</span>
                        </div>
                        {s.productName && <p className="text-xs text-slate-400 mt-1 truncate">{s.productName}</p>}
                        <div className="flex gap-2 mt-1.5 flex-wrap">
                          {s.lotNo && <Tag>LOT {s.lotNo}</Tag>}
                          {s.expireDate && <Tag>EXP {s.expireDate}</Tag>}
                          <Tag>{s.itemCondition || "GOOD"}</Tag>
                          {s.customerCode && <Tag>{s.customerCode}</Tag>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {/* qty + next */}
            {sel && (
              <div className="rounded-2xl p-4 sticky bottom-0" style={{ ...GLASS, background: "rgba(8,13,26,0.85)", backdropFilter: "blur(8px)" }}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-semibold text-slate-400">Move quantity</span>
                  <span className="text-[11px] text-slate-500">max {sel.qty}</span>
                </div>
                <div className="flex items-center gap-3">
                  <StepBtn onClick={() => setQty((q) => Math.max(1, q - 1))}>−</StepBtn>
                  <input
                    type="number"
                    value={qty}
                    onChange={(e) => setQty(Math.min(sel.qty, Math.max(1, Number(e.target.value) || 1)))}
                    className="flex-1 text-center rounded-xl py-2.5 text-white text-lg font-bold outline-none"
                    style={INPUT}
                  />
                  <StepBtn onClick={() => setQty((q) => Math.min(sel.qty, q + 1))}>+</StepBtn>
                </div>
                <button
                  onClick={() => setStep("to")}
                  className="mt-3 w-full rounded-xl py-3 font-semibold text-white flex items-center justify-center gap-2"
                  style={{ background: "#2563eb" }}
                >
                  Next: scan TO location <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* STEP 3 — TO SCAN */}
        {step === "to" && fromLoc && sel && (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl p-4" style={GLASS}>
              <div className="flex items-center gap-2 text-sm">
                <Package className="w-4 h-4 text-blue-300" />
                <span className="font-mono font-semibold text-white">{sel.productSku}</span>
                <span className="ml-auto text-white font-bold">× {qty}</span>
              </div>
              <div className="flex gap-2 mt-2 flex-wrap">
                {sel.lotNo && <Tag>LOT {sel.lotNo}</Tag>}
                {sel.expireDate && <Tag>EXP {sel.expireDate}</Tag>}
                <Tag>{sel.itemCondition || "GOOD"}</Tag>
              </div>
              <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
                <MapPin className="w-3.5 h-3.5" />
                <span className="font-mono">{fromLoc.locationCode}</span>
                <ArrowRight className="w-3.5 h-3.5" />
                <span className="text-slate-500">scan destination…</span>
              </div>
            </div>

            <div className="rounded-2xl p-5" style={GLASS}>
              <div className="flex items-center gap-2 mb-3 text-emerald-300">
                <ScanLine className="w-5 h-5" />
                <span className="text-sm font-semibold">TO Location</span>
              </div>
              <input
                ref={toRef}
                value={toScan}
                onChange={(e) => setToScan(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleToScan()}
                placeholder="Scan or type destination barcode"
                className="w-full rounded-xl px-4 py-3 text-white text-base outline-none placeholder:text-slate-500"
                style={{ ...INPUT, borderColor: "rgba(16,185,129,0.5)" }}
                autoComplete="off"
              />
              <button
                onClick={handleToScan}
                disabled={toLoading || moving || !toScan.trim()}
                className="mt-3 w-full rounded-xl py-3 font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: "#059669" }}
              >
                {(toLoading || moving) ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                {moving ? "Moving…" : "Confirm move"}
              </button>
            </div>
            {toError && <ErrorBox msg={toError} />}
          </div>
        )}

        {/* DONE */}
        {step === "done" && result && (
          <div className="flex flex-col items-center gap-5 py-10">
            <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(16,185,129,0.15)", border: "2px solid rgba(16,185,129,0.5)" }}>
              <CheckCircle2 className="w-9 h-9 text-emerald-400" />
            </div>
            <p className="text-lg font-bold text-white">Move complete</p>
            <div className="w-full rounded-2xl p-4" style={GLASS}>
              <Row k="SKU" v={result.sku} mono />
              <Row k="Qty" v={String(result.qty)} />
              <Row k="From" v={result.from} mono />
              <Row k="To" v={result.to} mono />
            </div>
            <button
              onClick={reset}
              className="w-full rounded-xl py-3 font-semibold text-white flex items-center justify-center gap-2"
              style={{ background: "#2563eb" }}
            >
              <RotateCcw className="w-5 h-5" /> Move another
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

/* ── small UI bits ── */
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-mono px-1.5 py-0.5 rounded text-slate-300" style={{ background: "rgba(255,255,255,0.08)" }}>{children}</span>;
}
function StepBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="w-12 h-12 rounded-xl text-2xl font-bold text-white flex items-center justify-center" style={GLASS}>{children}</button>;
}
function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl p-3.5 flex gap-2.5" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
      <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
      <p className="text-xs text-red-200 whitespace-pre-wrap leading-relaxed">{msg}</p>
    </div>
  );
}
function LocCard({ label, loc }: { label: string; loc: LocInfo }) {
  return (
    <div className="rounded-2xl p-4 flex items-center gap-3" style={GLASS}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(37,99,235,0.2)" }}>
        <MapPin className="w-5 h-5 text-blue-300" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{label}</p>
        <p className="font-mono text-sm text-white truncate">{loc.locationCode}</p>
      </div>
    </div>
  );
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex justify-between py-1.5 text-sm border-b last:border-0" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
      <span className="text-slate-400">{k}</span>
      <span className={`text-white font-semibold ${mono ? "font-mono" : ""}`}>{v}</span>
    </div>
  );
}
