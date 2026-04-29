import { authHeaders } from "./api";

export interface PickTask {
  idx: number;
  locationCode: string;
  zone: string;
  aisle: string;
  bay: string;
  level: string;
  position: string;
  sku: string;
  productName: string;
  allocatedQty: number;
  pickedQty: number;
  unit: "EA" | "CARTON" | null;
  status: "pending" | "done";
}

interface InvItem {
  zone: string; aisle: string; bay: string; level: string; position: string;
  locationCode?: string; locationId?: string;
  qty: number; availableQty?: number;
  productSku?: string; sku?: string;
  productName?: string;
  [k: string]: unknown;
}

interface OrderItem {
  productSku?: string; sku?: string; itemCode?: string;
  qty?: number; orderQty?: number; quantity?: number;
  productName?: string;
  [k: string]: unknown;
}

function parseLoc(s: string): number {
  const n = parseInt(s.replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function locKey(item: InvItem) {
  return [item.zone, item.aisle, item.bay, item.level, item.position].filter(Boolean).join("-");
}

export async function buildPickList(
  orderItems: OrderItem[],
  warehouseCode: string,
  customerCode: string
): Promise<PickTask[]> {
  const tasks: PickTask[] = [];
  let idx = 0;

  await Promise.all(
    orderItems.map(async (oi) => {
      const sku = String(oi.productSku ?? oi.sku ?? oi.itemCode ?? "");
      const needed = Number(oi.qty ?? oi.orderQty ?? oi.quantity ?? 0);
      const productName = String(oi.productName ?? sku);
      if (!sku || needed <= 0) return;

      let invItems: InvItem[] = [];
      try {
        const res = await fetch("/api/wms/inventory/detail", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ warehouseCode, customerCode, productSku: sku }),
        });
        const json = await res.json();
        const raw: Record<string, unknown>[] = json?.data?.list ?? json?.data ?? (Array.isArray(json) ? json : []);
        invItems = raw.map((r) => ({
          zone:      String(r.zoneName ?? r.zone ?? r.zoneCode ?? ""),
          aisle:     String(r.aisleName ?? r.aisle ?? r.aisleCode ?? ""),
          bay:       String(r.bayName ?? r.bay ?? r.bayCode ?? ""),
          level:     String(r.levelName ?? r.level ?? r.levelCode ?? ""),
          position:  String(r.positionName ?? r.position ?? r.positionCode ?? ""),
          qty:       Number(r.qty ?? r.quantity ?? r.onHandQty ?? 0),
          availableQty: Number(r.availableQty ?? r.availQty ?? r.qty ?? 0),
          locationId: String(r.locationId ?? r.inKey ?? ""),
          productSku: sku,
          productName,
          ...r,
        }));
      } catch { /* skip SKU if inventory fetch fails */ }

      // sort: aisle ASC → bay ASC → level ASC
      invItems.sort((a, b) => {
        const da = parseLoc(a.aisle) - parseLoc(b.aisle);
        if (da !== 0) return da;
        const db = parseLoc(a.bay) - parseLoc(b.bay);
        if (db !== 0) return db;
        return parseLoc(a.level) - parseLoc(b.level);
      });

      let remaining = needed;
      for (const loc of invItems) {
        if (remaining <= 0) break;
        const avail = loc.availableQty ?? loc.qty;
        if (avail <= 0) continue;
        const alloc = Math.min(avail, remaining);
        tasks.push({
          idx: idx++,
          locationCode: locKey(loc),
          zone: loc.zone, aisle: loc.aisle, bay: loc.bay,
          level: loc.level, position: loc.position,
          sku, productName,
          allocatedQty: alloc,
          pickedQty: 0,
          unit: null,
          status: "pending",
        });
        remaining -= alloc;
      }
    })
  );

  // re-sort tasks by location priority
  tasks.sort((a, b) => {
    const da = parseLoc(a.aisle) - parseLoc(b.aisle);
    if (da !== 0) return da;
    const db = parseLoc(a.bay) - parseLoc(b.bay);
    if (db !== 0) return db;
    return parseLoc(a.level) - parseLoc(b.level);
  });

  // re-index after sort
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
