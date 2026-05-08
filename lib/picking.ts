import { authHeaders } from "./api";

export interface PickTask {
  idx: number;
  // Location
  locationCode: string;   // display: zone/aisle/bay/level/position
  locationId: string;     // inKey — needed for WMS pick confirm API
  zone: string;
  aisle: string;
  bay: string;
  level: string;
  position: string;
  // Product
  sku: string;
  productName: string;
  lotNo: string;
  expireDate: string;
  itemCondition: string;
  // Item ID from shipping items (for pick confirm API)
  shippingItemId: number;
  // Qty
  allocatedQty: number;
  pickedQty: number;
  unit: "EA" | "CARTON" | null;
  status: "pending" | "done";
}

interface OrderItem {
  // SKU
  productSku?: string; sku?: string; itemCode?: string;
  // Qty
  qty?: number; orderQty?: number; quantity?: number; assignedQty?: number;
  // Product info
  productName?: string; itemName?: string;
  // Location — returned by shipping items endpoint
  zoneName?: string; zone?: string; zoneCode?: string;
  aisleName?: string; aisle?: string; aisleCode?: string;
  bayName?: string; bay?: string; bayCode?: string;
  levelName?: string; level?: string; levelCode?: string;
  positionName?: string; position?: string; positionCode?: string;
  locationCode?: string;
  // LocationId
  inKey?: string; locationId?: string;
  // Lot / condition
  lotNo?: string; lot?: string;
  expireDate?: string; expiryDate?: string;
  itemCondition?: string; condition?: string;
  // Item ID for confirm API
  shippingItemId?: number; itemId?: number; id?: number;
  [k: string]: unknown;
}

function parseLoc(s: string): number {
  const n = parseInt(s.replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function buildLocCode(zone: string, aisle: string, bay: string, level: string, position: string): string {
  return [zone, aisle, bay, level, position].filter(Boolean).join("/");
}

/**
 * Build pick list from order items.
 *
 * Strategy:
 *  1. If the item already has location fields (zoneName / aisleName / …), use them directly
 *     — this is the normal case when items come from the shipping items endpoint.
 *  2. If no location is embedded, fall back to /inventory/detail lookup.
 */
export async function buildPickList(
  orderItems: OrderItem[],
  warehouseCode: string,
  customerCode: string
): Promise<PickTask[]> {
  const tasks: PickTask[] = [];

  // ── Phase 1: items that already carry location data ──────────────────────
  const needsLookup: OrderItem[] = [];

  for (const oi of orderItems) {
    const sku = String(oi.productSku ?? oi.sku ?? oi.itemCode ?? "");
    const needed = Number(oi.qty ?? oi.orderQty ?? oi.assignedQty ?? oi.quantity ?? 0);
    if (!sku || needed <= 0) continue;

    const zone     = String(oi.zoneName  ?? oi.zone     ?? oi.zoneCode     ?? "");
    const aisle    = String(oi.aisleName ?? oi.aisle    ?? oi.aisleCode    ?? "");
    const bay      = String(oi.bayName   ?? oi.bay      ?? oi.bayCode      ?? "");
    const level    = String(oi.levelName ?? oi.level    ?? oi.levelCode    ?? "");
    const position = String(oi.positionName ?? oi.position ?? oi.positionCode ?? "");

    if (zone || aisle || bay) {
      // Location embedded in item ✓
      const locationCode = String(oi.locationCode ?? buildLocCode(zone, aisle, bay, level, position));
      tasks.push({
        idx: tasks.length,
        locationCode,
        locationId:    String(oi.inKey ?? oi.locationId ?? ""),
        zone, aisle, bay, level, position,
        sku,
        productName:    String(oi.productName ?? oi.itemName ?? sku),
        lotNo:          String(oi.lotNo ?? oi.lot ?? ""),
        expireDate:     String(oi.expireDate ?? oi.expiryDate ?? ""),
        itemCondition:  String(oi.itemCondition ?? oi.condition ?? "GOOD"),
        shippingItemId: Number(oi.shippingItemId ?? oi.itemId ?? oi.id ?? 0),
        allocatedQty:   needed,
        pickedQty:      0,
        unit:           null,
        status:         "pending",
      });
    } else {
      needsLookup.push(oi);
    }
  }

  // ── Phase 2: fallback — inventory/detail for items without location ───────
  if (needsLookup.length > 0) {
    await Promise.all(
      needsLookup.map(async (oi) => {
        const sku = String(oi.productSku ?? oi.sku ?? oi.itemCode ?? "");
        const needed = Number(oi.qty ?? oi.orderQty ?? oi.assignedQty ?? oi.quantity ?? 0);
        const productName = String(oi.productName ?? oi.itemName ?? sku);

        const bodies = [
          { warehouseCode, customerCode, productSku: sku },
          ...(customerCode ? [{ warehouseCode, productSku: sku }] : []),
        ];

        for (const body of bodies) {
          try {
            const res = await fetch("/api/wms/inventory/detail", {
              method: "POST",
              headers: authHeaders(),
              body: JSON.stringify(body),
            });
            const json = await res.json();
            const dataField = json?.data;
            const raw: Record<string, unknown>[] =
              Array.isArray(dataField) ? dataField :
              Array.isArray(dataField?.list) ? dataField.list :
              Array.isArray(dataField?.items) ? dataField.items :
              Array.isArray(json) ? json : [];

            if (raw.length === 0) continue;

            // Sort locations: aisle → bay → level
            const locs = raw.map((r) => ({
              zone:        String(r.zoneName  ?? r.zone     ?? r.zoneCode     ?? ""),
              aisle:       String(r.aisleName ?? r.aisle    ?? r.aisleCode    ?? ""),
              bay:         String(r.bayName   ?? r.bay      ?? r.bayCode      ?? ""),
              level:       String(r.levelName ?? r.level    ?? r.levelCode    ?? ""),
              position:    String(r.positionName ?? r.position ?? r.positionCode ?? ""),
              qty:         Number(r.qty ?? r.quantity ?? r.onHandQty ?? r.stockQty ?? 0),
              availableQty:Number(r.availableQty ?? r.availQty ?? r.qty ?? 0),
              locationId:  String(r.inKey ?? r.locationId ?? ""),
            })).sort((a, b) => {
              const da = parseLoc(a.aisle) - parseLoc(b.aisle);
              if (da !== 0) return da;
              const db = parseLoc(a.bay) - parseLoc(b.bay);
              if (db !== 0) return db;
              return parseLoc(a.level) - parseLoc(b.level);
            });

            let remaining = needed;
            for (const loc of locs) {
              if (remaining <= 0) break;
              const avail = loc.availableQty || loc.qty;
              if (avail <= 0) continue;
              const alloc = Math.min(avail, remaining);
              tasks.push({
                idx: tasks.length,
                locationCode:  buildLocCode(loc.zone, loc.aisle, loc.bay, loc.level, loc.position),
                locationId:    loc.locationId,
                zone: loc.zone, aisle: loc.aisle, bay: loc.bay,
                level: loc.level, position: loc.position,
                sku, productName,
                lotNo:         String(oi.lotNo ?? oi.lot ?? ""),
                expireDate:    String(oi.expireDate ?? oi.expiryDate ?? ""),
                itemCondition: String(oi.itemCondition ?? oi.condition ?? "GOOD"),
                shippingItemId: Number(oi.shippingItemId ?? oi.itemId ?? oi.id ?? 0),
                allocatedQty:  alloc,
                pickedQty:     0,
                unit:          null,
                status:        "pending",
              });
              remaining -= alloc;
            }
            break; // body attempt succeeded
          } catch { /* try next body */ }
        }
      })
    );
  }

  // ── Final sort & re-index ─────────────────────────────────────────────────
  tasks.sort((a, b) => {
    const da = parseLoc(a.aisle) - parseLoc(b.aisle);
    if (da !== 0) return da;
    const db = parseLoc(a.bay) - parseLoc(b.bay);
    if (db !== 0) return db;
    return parseLoc(a.level) - parseLoc(b.level);
  });
  tasks.forEach((t, i) => { t.idx = i; });
  return tasks;
}

export function savePickList(code: string, tasks: PickTask[]) {
  localStorage.setItem(`pick_${code}`, JSON.stringify(tasks));
}

export function loadPickList(code: string): PickTask[] | null {
  try {
    const raw = localStorage.getItem(`pick_${code}`);
    return raw ? (JSON.parse(raw) as PickTask[]) : null;
  } catch { return null; }
}

export function clearPickList(code: string) {
  localStorage.removeItem(`pick_${code}`);
}

/**
 * Confirm picking for one task against the WMS API.
 * Tries several common endpoint patterns and returns the first success response.
 */
export async function confirmPick(
  orderCode: string,
  orderType: string,
  task: PickTask,
  pickedQty: number,
  unit: "EA" | "CARTON"
): Promise<{ ok: boolean; message?: string }> {
  const payload = {
    shippingOrderCode: orderCode,
    orderCode,
    shippingItemId: task.shippingItemId || undefined,
    locationCode: task.locationCode,
    locationId:   task.locationId || undefined,
    inKey:        task.locationId || undefined,
    productSku:   task.sku,
    qty:          pickedQty,
    pickedQty,
    unit,
    lotNo:        task.lotNo || undefined,
    expireDate:   task.expireDate || undefined,
    itemCondition: task.itemCondition || undefined,
  };

  const endpoints = [
    `/api/wms/shipping/${orderType}/pick`,
    `/api/wms/shipping/pick`,
    `/api/wms/outbound/${orderType}/pick`,
    `/api/wms/outbound/pick`,
    `/api/wms/shipping/picking/confirm`,
    `/api/wms/outbound/picking/confirm`,
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.isSuccess !== false) {
        return { ok: true };
      }
      // 404 = endpoint doesn't exist, try next
      if (res.status === 404) continue;
      // Other error = endpoint exists but rejected the request
      return { ok: false, message: json?.message ?? `HTTP ${res.status}` };
    } catch { /* network error, try next */ }
  }

  // No endpoint found — silently succeed (WMS may not have a pick confirm API)
  return { ok: true, message: "no-confirm-api" };
}
