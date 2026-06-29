import { authHeaders } from "./api";
import { buildPickList, confirmPick } from "./picking";
import type { PickTask } from "./picking";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClusterBin {
  binNo: number;       // 1–25
  orderCode: string;
  customerCode: string;
}

export interface ClusterPickTask extends PickTask {
  binNo: number;
  orderCode: string;
}

export interface LocationGroup {
  locKey: string;          // normalized key for grouping (no separators)
  locationCode: string;    // display string
  locationId: string;
  zoneName: string;
  aisleName: string;
  bayName: string;
  levelName: string;
  positionName: string;
  tasks: ClusterPickTask[];
}

export interface Cluster {
  id: string;          // Date.now().toString()
  bins: ClusterBin[];
  type: string;        // "b2c"
  warehouseCode: string;
  createdAt: string;
}

// ── 25-color palette for bin tiles ───────────────────────────────────────────

export const BIN_COLORS: { bg: string; text: string; border: string }[] = [
  { bg: "rgba(59,130,246,0.25)",  text: "#93c5fd", border: "rgba(59,130,246,0.5)"  }, // blue
  { bg: "rgba(168,85,247,0.25)",  text: "#d8b4fe", border: "rgba(168,85,247,0.5)"  }, // purple
  { bg: "rgba(34,197,94,0.25)",   text: "#86efac", border: "rgba(34,197,94,0.5)"   }, // green
  { bg: "rgba(245,158,11,0.25)",  text: "#fcd34d", border: "rgba(245,158,11,0.5)"  }, // amber
  { bg: "rgba(239,68,68,0.25)",   text: "#fca5a5", border: "rgba(239,68,68,0.5)"   }, // red
  { bg: "rgba(20,184,166,0.25)",  text: "#5eead4", border: "rgba(20,184,166,0.5)"  }, // teal
  { bg: "rgba(236,72,153,0.25)",  text: "#f9a8d4", border: "rgba(236,72,153,0.5)"  }, // pink
  { bg: "rgba(99,102,241,0.25)",  text: "#a5b4fc", border: "rgba(99,102,241,0.5)"  }, // indigo
  { bg: "rgba(234,179,8,0.25)",   text: "#fde047", border: "rgba(234,179,8,0.5)"   }, // yellow
  { bg: "rgba(6,182,212,0.25)",   text: "#67e8f9", border: "rgba(6,182,212,0.5)"   }, // cyan
  { bg: "rgba(249,115,22,0.25)",  text: "#fdba74", border: "rgba(249,115,22,0.5)"  }, // orange
  { bg: "rgba(16,185,129,0.25)",  text: "#6ee7b7", border: "rgba(16,185,129,0.5)"  }, // emerald
  { bg: "rgba(139,92,246,0.25)",  text: "#c4b5fd", border: "rgba(139,92,246,0.5)"  }, // violet
  { bg: "rgba(244,63,94,0.25)",   text: "#fda4af", border: "rgba(244,63,94,0.5)"   }, // rose
  { bg: "rgba(14,165,233,0.25)",  text: "#7dd3fc", border: "rgba(14,165,233,0.5)"  }, // sky
  { bg: "rgba(132,204,22,0.25)",  text: "#bef264", border: "rgba(132,204,22,0.5)"  }, // lime
  { bg: "rgba(251,191,36,0.25)",  text: "#fde68a", border: "rgba(251,191,36,0.5)"  }, // warm yellow
  { bg: "rgba(52,211,153,0.25)",  text: "#6ee7b7", border: "rgba(52,211,153,0.5)"  }, // mint
  { bg: "rgba(217,70,239,0.25)",  text: "#f0abfc", border: "rgba(217,70,239,0.5)"  }, // fuchsia
  { bg: "rgba(45,212,191,0.25)",  text: "#99f6e4", border: "rgba(45,212,191,0.5)"  }, // turquoise
  { bg: "rgba(251,113,133,0.25)", text: "#fda4af", border: "rgba(251,113,133,0.5)" }, // light rose
  { bg: "rgba(96,165,250,0.25)",  text: "#bfdbfe", border: "rgba(96,165,250,0.5)"  }, // light blue
  { bg: "rgba(167,243,208,0.15)", text: "#a7f3d0", border: "rgba(52,211,153,0.5)"  }, // pale mint
  { bg: "rgba(196,181,253,0.2)",  text: "#ede9fe", border: "rgba(139,92,246,0.5)"  }, // pale violet
  { bg: "rgba(253,186,116,0.2)",  text: "#fed7aa", border: "rgba(249,115,22,0.5)"  }, // pale orange
];

export function binColor(binNo: number) {
  return BIN_COLORS[(binNo - 1) % BIN_COLORS.length];
}

// ── localStorage helpers ──────────────────────────────────────────────────────

export function saveCluster(cluster: Cluster) {
  localStorage.setItem(`cluster_${cluster.id}`, JSON.stringify(cluster));
}

export function getCluster(id: string): Cluster | null {
  try {
    const raw = localStorage.getItem(`cluster_${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearCluster(id: string) {
  localStorage.removeItem(`cluster_${id}`);
  localStorage.removeItem(`cluster_locs_${id}`);
  localStorage.removeItem(`cluster_done_${id}`);
}

export function saveLocationGroups(id: string, groups: LocationGroup[]) {
  localStorage.setItem(`cluster_locs_${id}`, JSON.stringify(groups));
}

export function getLocationGroups(id: string): LocationGroup[] | null {
  try {
    const raw = localStorage.getItem(`cluster_locs_${id}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function getDoneSet(id: string): Set<number> {
  try {
    const raw = localStorage.getItem(`cluster_done_${id}`);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch { return new Set(); }
}

export function markLocationDone(id: string, locIdx: number) {
  const done = getDoneSet(id);
  done.add(locIdx);
  localStorage.setItem(`cluster_done_${id}`, JSON.stringify([...done]));
}

export function listActiveClusterIds(): string[] {
  const ids: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("cluster_") && !key.includes("_locs_") && !key.includes("_done_")) {
      ids.push(key.replace("cluster_", ""));
    }
  }
  return ids;
}

// ── Location key normalization ────────────────────────────────────────────────

function parseLoc(s: string): number {
  const n = parseInt(s.replace(/\D/g, ""), 10);
  return isNaN(n) ? 0 : n;
}

function makeLocKey(zone: string, aisle: string, bay: string, level: string, position: string): string {
  return [zone, aisle, bay, level, position].map((s) => s.toLowerCase().replace(/\D/g, "").padStart(3, "0")).join("");
}

// ── Build cluster pick list ───────────────────────────────────────────────────
// Phase 1: parallel batch-check picking status (BATCH_SIZE at a time), stop once
//          we have maxBins valid orders — no need to scan all 500 candidates.
// Phase 2: parallel fetch pick tasks for the maxBins valid orders.

const BATCH_SIZE = 20; // concurrent picking-status checks per batch

async function fetchPickingItems(orderCode: string, type: string): Promise<unknown[]> {
  const endpoints = [
    `/api/wms/shipping/${type}/picking/${orderCode}`,
    `/api/wms/shipping/picking/${orderCode}`,
    `/api/wms/outbound/${type}/picking/${orderCode}`,
  ];
  for (const ep of endpoints) {
    try {
      const r = await fetch(ep, { headers: authHeaders() });
      const j = await r.json().catch(() => null);
      const list = j?.data?.list ?? j?.data?.items ?? j?.data ?? j?.list ?? j?.items ?? (Array.isArray(j) ? j : null);
      if (r.ok && Array.isArray(list) && list.length > 0) return list;
    } catch { /* try next endpoint */ }
  }
  return [];
}

export async function buildClusterPickList(
  candidates: Array<{ orderCode: string; customerCode: string }>,
  maxBins: number,
  type: string,
  warehouseCode: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ bins: ClusterBin[]; groups: LocationGroup[] }> {
  // Phase 1: scan candidates in parallel batches until we have maxBins valid orders
  const valid: Array<{ cand: { orderCode: string; customerCode: string }; rawItems: unknown[] }> = [];
  let checked = 0;

  for (let i = 0; i < candidates.length && valid.length < maxBins; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    onProgress?.(checked, candidates.length);

    const batchResults = await Promise.all(
      batch.map(async (cand) => ({ cand, rawItems: await fetchPickingItems(cand.orderCode, type) }))
    );

    checked += batch.length;
    onProgress?.(checked, candidates.length);

    for (const { cand, rawItems } of batchResults) {
      if (rawItems.length > 0 && valid.length < maxBins) {
        valid.push({ cand, rawItems });
      }
    }
  }

  // Phase 2: build pick tasks for all valid orders in parallel
  const bins: ClusterBin[] = valid.map(({ cand }, i) => ({
    binNo: i + 1,
    orderCode: cand.orderCode,
    customerCode: cand.customerCode,
  }));

  const taskArrays = await Promise.all(
    valid.map(({ cand, rawItems }, i) =>
      buildPickList(rawItems as Record<string, unknown>[], warehouseCode, cand.customerCode).then(
        (tasks) => tasks.map((t) => ({ ...t, binNo: i + 1, orderCode: cand.orderCode }) as ClusterPickTask)
      )
    )
  );

  const allTasks = taskArrays.flat();

  // Group by location
  const groupMap = new Map<string, LocationGroup>();
  for (const task of allTasks) {
    const key = makeLocKey(task.zone, task.aisle, task.bay, task.level, task.position);
    if (!groupMap.has(key)) {
      groupMap.set(key, {
        locKey: key,
        locationCode: task.locationCode,
        locationId: task.locationId,
        zoneName: task.zone,
        aisleName: task.aisle,
        bayName: task.bay,
        levelName: task.level,
        positionName: task.position,
        tasks: [],
      });
    }
    groupMap.get(key)!.tasks.push(task);
  }

  // Sort groups by aisle → bay → level
  const groups = [...groupMap.values()].sort((a, b) => {
    const da = parseLoc(a.aisleName) - parseLoc(b.aisleName);
    if (da !== 0) return da;
    const db = parseLoc(a.bayName) - parseLoc(b.bayName);
    if (db !== 0) return db;
    return parseLoc(a.levelName) - parseLoc(b.levelName);
  });

  return { bins, groups };
}

// Re-export confirmPick so cluster pages don't need to import from picking.ts directly
export { confirmPick };
export type { PickTask };
