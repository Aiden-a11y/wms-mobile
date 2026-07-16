"use client";
import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft, CheckCircle2, MapPin, Package,
  RefreshCw, ScanLine, AlertCircle, Loader2, RotateCcw, ArrowRight, Boxes,
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
  warehouseCd: string;
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

/**
 * Occupancy check — 2 sequential API calls only, no background work.
 * 1. inventory/detail for tag's customerCode+SKU → catches same-customer stock
 * 2. location/list qty check → catches any customer (if API returns qty fields)
 */
async function checkLocationOccupied(
  loc: LocationInfo,
  warehouseCode: string,
  customerCode: string,
  productSku: string,
  tagLotNo = "",
  tagExpireDate = "",
): Promise<string | null> {
  const pad = (s: string) => String(s).padStart(2, "0");
  const locBarcode = [loc.zoneName, loc.aisleName, loc.bayName, loc.levelName, loc.positionName]
    .map(pad).join("");
  const locNorm = loc.locationCode.toLowerCase().replace(/[\s\-_/]+/g, "");

  // ── Call 1: inventory/detail ────────────────────────────────
  try {
    const r = await fetch("/api/wms/inventory/detail", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ warehouseCode, customerCode, productSku }),
    });
    const j = await r.json().catch(() => null);
    const dataField = j?.data;
    const items: Record<string, unknown>[] =
      Array.isArray(dataField)       ? dataField       :
      Array.isArray(dataField?.list) ? dataField.list  :
      Array.isArray(j)               ? j               : [];

    const hit = items.find((item) => {
      const bc = [item.zoneName ?? item.zone ?? item.zoneCode,
                  item.aisleName ?? item.aisle ?? item.aisleCode,
                  item.bayName ?? item.bay ?? item.bayCode,
                  item.levelName ?? item.level ?? item.levelCode,
                  item.positionName ?? item.position ?? item.positionCode]
        .map((v) => pad(String(v ?? ""))).join("");
      const lc = String(item.locationCode ?? item.remark ?? "").toLowerCase().replace(/[\s\-_/]+/g, "");
      return bc === locBarcode || lc === locNorm;
    });

    if (hit) {
      const normDate = (s: string) => s.replace(/\D/g, "").slice(0, 8);
      const hitLot = String(hit.lotNo ?? hit.lot ?? "").trim();
      const hitExp = normDate(String(hit.expireDate ?? hit.expiryDate ?? hit.expDate ?? ""));
      const normLot = tagLotNo.trim();
      const normExp = normDate(tagExpireDate);
      // Same SKU + same LOT + same EXP → adding to existing stock, allow
      if (hitLot === normLot && hitExp === normExp) return null;
      const qty = Number(hit.qty ?? hit.availableQty ?? 0);
      return `Location already has different lot/exp.\nExisting: LOT ${hitLot || "—"}  EXP ${hitExp || "—"}  Qty: ${qty}\nYours: LOT ${normLot || "—"}  EXP ${normExp || "—"}\nPlease scan a different location.`;
    }
  } catch { /* skip to call 2 */ }

  // ── Call 2: location/list qty check ────────────────────────
  try {
    const r = await fetch("/api/wms/warehouse/location/list", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ page: 1, pageSize: 20, warehouseCode, search: loc.locationCode }),
    });
    const j = await r.json().catch(() => null);
    const rows: Record<string, unknown>[] =
      Array.isArray(j?.data?.list) ? j.data.list :
      Array.isArray(j?.data)       ? j.data       :
      Array.isArray(j)             ? j             : [];

    const match = rows.find((row) => {
      const bc = [row.zoneNm ?? row.zoneName ?? row.zone,
                  row.aisleNm ?? row.aisleName ?? row.aisle,
                  row.bayNm ?? row.bayName ?? row.bay,
                  row.levelNm ?? row.levelName ?? row.level,
                  row.positionNm ?? row.positionName ?? row.position]
        .map((v) => pad(String(v ?? ""))).join("");
      const lc = String(row.locationCode ?? row.remark ?? "").toLowerCase().replace(/[\s\-_/]+/g, "");
      return bc === locBarcode || lc === locNorm;
    });

    if (match) {
      const qty = Number(match.currentQty ?? match.locQty ?? match.qty ?? match.inventoryQty ?? -1);
      if (qty > 0) return `Location already occupied (qty: ${qty}).\nPlease scan a different location.`;
    }
  } catch { /* inconclusive — allow */ }

  return null;
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
  const [remainingQty, setRemainingQty] = useState(0);
  const [location, setLocation] = useState<LocationInfo | null>(null);
  const locationRef = useRef<LocationInfo | null>(null);
  const rawScanRef = useRef<string>("");
  const [locScan, setLocScan] = useState("");
  const [locLoading, setLocLoading] = useState(false);
  const [locError, setLocError] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState("");

  // Inventory locations for this SKU
  interface InvLocItem {
    locationCode: string;
    qty: number;
    lotNo: string;
    expDate: string;
    locTypeLabel: string;
    locType: "shelf" | "pallet" | "unknown";
  }
  const [invLocs, setInvLocs] = useState<InvLocItem[] | null>(null);
  const [invLocsLoading, setInvLocsLoading] = useState(false);

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

        if (!found.customerCode || !found.warehouseCd) {
          try {
            const headers = authHeaders();
            // Step 1: try items endpoint for warehouseCd + customerCode
            const itemsRes = await fetch(`/api/wms/receiving/items/${found.orderCode}`, { headers });
            const itemsJson = await itemsRes.json().catch(() => null);
            const items: Record<string, unknown>[] =
              Array.isArray(itemsJson?.data?.items) ? itemsJson.data.items :
              Array.isArray(itemsJson?.data?.list)  ? itemsJson.data.list  :
              Array.isArray(itemsJson?.data)        ? itemsJson.data       : [];
            const matchItem = items.find(
              (r) => Number(r.receiveItemId ?? r.itemId) === found!.receiveItemId
            ) ?? items[0];
            if (matchItem) {
              found = {
                ...found,
                customerCode: found.customerCode || String(matchItem.customerCode ?? ""),
                warehouseCode: found.warehouseCode || String(matchItem.warehouseCode ?? "STOO1"),
                warehouseCd:   found.warehouseCd   || String(matchItem.warehouseCd  ?? matchItem.warehouseId ?? ""),
              };
            }
            // Step 2: if customerCode still missing, fetch order header
            if (!found.customerCode) {
              const orderRes = await fetch(`/api/wms/receiving/${found.orderCode}`, { headers });
              const orderJson = await orderRes.json().catch(() => null);
              const ord = orderJson?.data ?? orderJson;
              const cc = String(ord?.customerCode ?? ord?.customer?.customerCode ?? "");
              if (cc) found = { ...found, customerCode: cc };
            }
          } catch { /* ignore */ }
        }

        setTag(found);
        setQty(found.qty);

        // Fetch inventory locations in background
        fetchInvLocs(found.warehouseCode || "STOO1", found.customerCode, found.sku);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Network error loading tag");
      }
      setLoadingTag(false);
    }
    fetchTag();
  }, [tagId]);

  async function fetchInvLocs(warehouseCode: string, customerCode: string, productSku: string) {
    setInvLocsLoading(true);
    const normLoc = (s: string) => s.toLowerCase().replace(/[\s\-_/]+/g, "");

    const getOcc = async (locCode: string): Promise<string> => {
      try {
        const r = await fetch("/api/wms/warehouse/location/list", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ page: 1, pageSize: 20, warehouseCode, search: locCode }),
        });
        const j = await r.json().catch(() => null);
        const rows: Record<string, unknown>[] =
          Array.isArray(j?.data?.list) ? j.data.list :
          Array.isArray(j?.data)       ? j.data       :
          Array.isArray(j)             ? j             : [];
        const match = rows.find((row) =>
          normLoc(String(row.locationCode ?? row.location ?? "")) === normLoc(locCode)
        );
        return match ? String(match.occupancyInfo ?? "").trim() : "";
      } catch { return ""; }
    };

    try {
      const invRes = await fetch("/api/wms/inventory/detail", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ warehouseCode, customerCode, productSku }),
      });
      const invJson = await invRes.json().catch(() => null);

      const dataField = invJson?.data;
      const items: Record<string, unknown>[] =
        Array.isArray(dataField)       ? dataField       :
        Array.isArray(dataField?.list) ? dataField.list  :
        Array.isArray(invJson)         ? invJson         : [];

      const withQty = items.filter((item) => Number(item.qty ?? item.availableQty ?? 0) > 0);

      // Per-location occupancy lookup (parallel, one search per unique location)
      const locCodes = withQty.map((item) => {
        const z = String(item.zoneName  ?? item.zone  ?? "");
        const a = String(item.aisleName ?? item.aisle ?? "");
        const b = String(item.bayName   ?? item.bay   ?? "");
        const l = String(item.levelName ?? item.level ?? "");
        const p = String(item.positionName ?? item.position ?? "");
        return String(item.locationCode ?? [z, a, b, l, p].filter(Boolean).join("-"));
      });
      const uniqueCodes = [...new Set(locCodes)];
      const occResults = await Promise.all(uniqueCodes.map((lc) => getOcc(lc)));
      const occMap = new Map(uniqueCodes.map((lc, i) => [normLoc(lc), occResults[i]]));

      const parsed: InvLocItem[] = withQty
        .map((item) => {
          const z = String(item.zoneName  ?? item.zone  ?? "");
          const a = String(item.aisleName ?? item.aisle ?? "");
          const b = String(item.bayName   ?? item.bay   ?? "");
          const l = String(item.levelName ?? item.level ?? "");
          const p = String(item.positionName ?? item.position ?? "");
          const locationCode = String(item.locationCode ?? [z, a, b, l, p].filter(Boolean).join("-"));
          const qty     = Number(item.qty ?? item.availableQty ?? 0);
          const lotNo   = String(item.lotNo ?? item.lot ?? "");
          const expDate = String(item.expireDate ?? item.expiryDate ?? item.expDate ?? "").slice(0, 10);

          const rawOcc = (occMap.get(normLoc(locationCode)) ?? "").toUpperCase();
          const isPick   = rawOcc.includes("PICK");
          const isPallet = rawOcc.includes("PALLET") || rawOcc.includes("STOR") || rawOcc.includes("RESERVE");
          const locType: "shelf" | "pallet" | "unknown" = isPick ? "shelf" : isPallet ? "pallet" : "unknown";
          const locTypeLabel = isPick ? "SHELF" : isPallet ? "PALLET" : "";

          return { locationCode: locationCode.replace(/\//g, "-"), qty, lotNo, expDate, locType, locTypeLabel };
        })
        .sort((a, b) => {
          const n = (s: string) => parseInt(s.replace(/\D/g, "") || "0", 10);
          const [az, aa, ab] = a.locationCode.split(/[/\-]/).map(n);
          const [bz, ba, bb] = b.locationCode.split(/[/\-]/).map(n);
          return (az - bz) || (aa - ba) || (ab - bb);
        });

      setInvLocs(parsed);
    } catch { setInvLocs([]); }
    setInvLocsLoading(false);
  }

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
      const wc = tag.warehouseCode || "STOO1";

      // POST with { search, warehouseCode } — confirmed correct from network capture
      const res = await fetch(`/api/wms/warehouse/location-search`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ search: raw, warehouseCode: wc }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 401) {
          setLocError(`Session expired (401). Please go back and log in again.`);
        } else {
          setLocError(
            `Location API error ${res.status}: ${(json as Record<string,unknown>)?.message ?? JSON.stringify(json)?.slice(0, 200)}\n` +
            `(barcode: ${raw}, warehouse: ${wc})`
          );
        }
        setLocLoading(false);
        return;
      }

      const dataRaw = (json as Record<string,unknown>)?.data;
      const d = (Array.isArray(dataRaw) ? dataRaw[0] : dataRaw) as Record<string, unknown> | null ?? null;

      if (!d) {
        setLocError(`Location "${raw}" not found.\nAPI: ${JSON.stringify(json)?.slice(0, 200)}`);
        setLocLoading(false);
        return;
      }

      const zoneName     = String(d.zoneName    ?? d.zone     ?? "");
      const aisleName    = String(d.aisleName   ?? d.aisle    ?? "");
      const bayName      = String(d.bayName     ?? d.bay      ?? "");
      const levelName    = String(d.levelName   ?? d.level    ?? "");
      const positionName = String(d.positionName ?? d.position ?? "");
      const locationCode = String(
        d.locationCode ?? d.code ??
        ([zoneName, aisleName, bayName, levelName, positionName].filter(Boolean).join(" / ") || raw)
      );
      const locationId = d.locationId != null ? String(d.locationId) : (d.id != null ? String(d.id) : "");
      const locationWarehouseCd = d.warehouseCd != null ? String(d.warehouseCd) : "";

      const loc: LocationInfo = { locationCode, locationId, warehouseCd: locationWarehouseCd, zoneName, aisleName, bayName, levelName, positionName };

      // ── Occupancy check (after location-search, no concurrent requests) ──
      const blocked = await checkLocationOccupied(loc, wc, tag.customerCode, tag.sku, tag.lotNo ?? "", tag.expireDate ?? "");
      if (blocked) {
        setLocError(blocked);
        setLocLoading(false);
        return;
      }

      rawScanRef.current = raw;
      locationRef.current = loc;
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
    let loc = locationRef.current ?? location;
    if (!loc) {
      try {
        const stored = sessionStorage.getItem("stow_loc");
        if (stored) loc = JSON.parse(stored) as LocationInfo;
      } catch { /* ignore */ }
    }
    if (!tag || !loc) return;
    setAssigning(true);
    setAssignError("");
    try {
      const expireDate = tag.expireDate?.replace(/-/g, "").slice(0, 8) ?? "";
      const wc = tag.warehouseCode || "STOO1";

      const payload = {
        receiveOrderCode: tag.orderCode,
        receiveItemId: tag.receiveItemId,
        warehouseCode: wc,
        warehouseCd: loc.warehouseCd || tag.warehouseCd || wc,
        customerCode: tag.customerCode,
        productSku: tag.sku,
        lotNo: tag.lotNo ?? "",
        expireDate,
        itemCondition: tag.itemCondition ?? "GOOD",
        qty,
        locationCode: loc.locationCode || rawScanRef.current,
        locationId: loc.locationId ?? "",
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

      // Record stow placement in our own log (backend only reflects it after the
      // whole receiving order is completed, so we track it ourselves).
      fetch("/api/stow-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: tag.sku,
          productName: tag.productName,
          qty,
          locationCode: loc.locationCode || rawScanRef.current,
          warehouseCode: wc,
          customerCode: tag.customerCode,
          orderCode: tag.orderCode,
          lotNo: tag.lotNo ?? "",
          expireDate,
        }),
      }).catch(() => { /* non-blocking */ });

      const remaining = tag.qty - qty;

      if (tagId) {
        // Partial stow → update remaining qty in Redis (keep pending)
        // Full stow   → mark as done
        await fetch(`/api/stow-tags/${tagId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ remainingQty: remaining }),
        });
      }

      setRemainingQty(remaining);
      setStep("done");
    } catch (e) {
      setAssignError(e instanceof Error ? e.message : "Assign failed");
    }
    setAssigning(false);
  }

  // ── Continue stowing remaining qty ──────────────────────
  function handleStowRemaining() {
    // Reset to qty step with updated qty = remainingQty
    if (!tag) return;
    setQty(remainingQty);
    setLocation(null);
    locationRef.current = null;
    setLocScan("");
    setLocError("");
    setAssignError("");
    // Update tag's qty locally so UI reflects the remaining
    setTag({ ...tag, qty: remainingQty });
    setStep("qty");
  }

  // ── Loading ──────────────────────────────────────────────
  if (loadingTag) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={DARK}>
        <RefreshCw className="w-8 h-8 animate-spin text-slate-500" />
      </div>
    );
  }

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

  // ── Done screen ──────────────────────────────────────────
  if (step === "done") {
    const isPartial = remainingQty > 0;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-5" style={DARK}>
        {/* Icon */}
        <div className="w-20 h-20 rounded-full flex items-center justify-center"
          style={isPartial
            ? { background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)" }
            : { background: "rgba(34,197,94,0.15)",  border: "1px solid rgba(34,197,94,0.3)" }}>
          <CheckCircle2 className={`w-10 h-10 ${isPartial ? "text-amber-400" : "text-green-400"}`} />
        </div>

        {/* Title */}
        <div className="text-center">
          <p className="text-2xl font-bold text-white mb-1">
            {isPartial ? "Partial Stow Done" : "Stow Complete!"}
          </p>
          <p className="text-sm text-slate-400 font-mono">{tag.sku} × {qty} stowed</p>
          {isPartial && (
            <p className="text-sm font-semibold mt-1"
              style={{ color: "#fbbf24" }}>
              {remainingQty} remaining — stow to another location
            </p>
          )}
        </div>

        {/* Summary */}
        <div className="w-full rounded-2xl p-5 space-y-3" style={GLASS}>
          {[
            ["SKU",          tag.sku],
            ["Stowed",       String(qty)],
            ...(isPartial ? [["Remaining", String(remainingQty)]] : []),
            ["Location",     location ? locLabel(location) : "-"],
            ...(tag.lotNo    ? [["LOT", tag.lotNo]] : []),
            ...(tag.expireDate ? [["EXP", tag.expireDate.slice(0, 10)]] : []),
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span className="text-slate-400">{k}</span>
              <span className={`font-mono font-semibold ${
                k === "Stowed"     ? "text-green-400" :
                k === "Remaining"  ? "text-amber-400" : "text-white"
              }`}>{v}</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        {isPartial ? (
          <div className="flex flex-col gap-3 w-full">
            <button
              onClick={handleStowRemaining}
              className="w-full h-14 rounded-2xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
              style={{ background: "#d97706" }}
            >
              <ArrowRight className="w-4 h-4" />
              Stow Remaining {remainingQty} →
            </button>
            <button
              onClick={() => router.replace("/inbound")}
              className="w-full h-12 rounded-2xl text-sm font-semibold text-slate-400 active:scale-[0.98] transition-all"
              style={GLASS}
            >
              Save & Come Back Later
            </button>
          </div>
        ) : (
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
        )}
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
        {/* Item info */}
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
              <p className="text-xs text-slate-500 mb-0.5">Remaining</p>
              <p className="text-xl font-bold text-white">{tag.qty}</p>
            </div>
          </div>
        </div>

        {/* ── Inventory locations (always visible from qty step) ── */}
        {(step === "qty" || step === "location" || step === "confirm") && (
          <div className="rounded-2xl p-4" style={GLASS}>
            <div className="flex items-center gap-2 mb-2">
              <Boxes className="w-4 h-4 text-slate-500" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Current Stock Locations</p>
              {invLocsLoading && <Loader2 className="w-3 h-3 animate-spin text-slate-600 ml-auto" />}
            </div>
            {invLocsLoading && !invLocs && (
              <div className="space-y-2">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="h-5 rounded animate-pulse" style={{ background: "rgba(255,255,255,0.05)" }} />
                ))}
              </div>
            )}
            {invLocs && invLocs.length === 0 && (
              <p className="text-xs text-slate-600">No stock found in system</p>
            )}
            {invLocs && invLocs.length > 0 && (
              <div className="space-y-2.5">
                {invLocs.map((loc, i) => (
                  <div key={i} className="rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    {/* Row 1: location + badge + qty */}
                    <div className="flex items-center gap-2">
                      <MapPin className="w-3 h-3 text-slate-500 flex-shrink-0" />
                      <span className="font-mono text-xs text-slate-200 flex-1 truncate">{loc.locationCode}</span>
                      {loc.locTypeLabel && (
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md flex-shrink-0"
                          style={loc.locType === "shelf"
                            ? { background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }
                            : loc.locType === "pallet"
                            ? { background: "rgba(251,191,36,0.15)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.3)" }
                            : { background: "rgba(255,255,255,0.06)", color: "#94a3b8", border: "1px solid rgba(255,255,255,0.1)" }
                          }>
                          {loc.locTypeLabel}
                        </span>
                      )}
                      <span className="text-sm font-bold text-white flex-shrink-0">{loc.qty} EA</span>
                    </div>
                    {/* Row 2: LOT / EXP */}
                    {(loc.lotNo || loc.expDate) && (
                      <div className="flex gap-3 mt-1.5 pl-5">
                        {loc.lotNo  && <span className="text-xs text-slate-500">LOT <span className="text-slate-400 font-mono">{loc.lotNo}</span></span>}
                        {loc.expDate && <span className="text-xs text-slate-500">EXP <span className="text-slate-400 font-mono">{loc.expDate}</span></span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── QTY ── */}
        {step === "qty" && (
          <div className="rounded-2xl p-4 space-y-4"
            style={{ ...GLASS, border: "1px solid rgba(59,130,246,0.3)" }}>
            <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider">
              Enter Stow Quantity
              {tag.qty > 0 && <span className="ml-2 text-slate-500 normal-case">(max {tag.qty})</span>}
            </p>
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
            {qty < tag.qty && (
              <p className="text-xs text-amber-400 text-center">
                {tag.qty - qty} will remain after this stow
              </p>
            )}
            <button
              onClick={() => { if (qty > 0 && !invLocsLoading) setStep("location"); }}
              disabled={invLocsLoading}
              className="w-full py-4 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-60"
              style={{ background: "#3b82f6" }}
            >
              {invLocsLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
                : <>Next — Scan Location <MapPin className="w-4 h-4" /></>
              }
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
              <div className="flex items-start gap-2 rounded-xl px-3 py-3 text-xs text-red-300"
                style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.3)" }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-red-400" />
                <span className="whitespace-pre-line leading-relaxed">{locError}</span>
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
        {step === "confirm" && (() => {
          const loc = locationRef.current ?? location;
          return loc ? (
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
                  ["SKU",      tag?.sku ?? ""],
                  ["Qty",      String(qty)],
                  ...(qty < tag.qty ? [["After this", `${tag.qty - qty} remaining`]] : []),
                  ["Location", locLabel(loc)],
                  ...(tag?.lotNo      ? [["LOT", tag.lotNo]] : []),
                  ...(tag?.expireDate ? [["EXP", tag.expireDate.slice(0, 10)]] : []),
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-slate-400">{k}</span>
                    <span className={`font-mono font-semibold ${k === "After this" ? "text-amber-400" : "text-white"}`}>{v}</span>
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
          ) : null;
        })()}
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
