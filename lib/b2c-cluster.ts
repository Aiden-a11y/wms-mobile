export interface B2CClusterTask {
  binNo: number;
  orderCode: string;
  sku: string;
  skuName: string;
  qty: number;
  locationId?: string;
  lotNo?: string;
  expireDate?: string;
  itemCondition?: string;
  shippingItemId?: number;
}

export interface B2CClusterLocationGroup {
  locationCode: string;
  locationId?: string;
  tasks: B2CClusterTask[];
}

export interface B2CClusterItem {
  sku: string;
  name: string;
  qty: number;
  locationCode: string;
  locationId?: string;
  lotNo?: string;
  expireDate?: string;
  itemCondition?: string;
  shippingItemId?: number;
}

export interface B2CClusterBin {
  binNo: number;
  orderCode: string;
  customerCode: string;
  orderNo?: string;
  items: B2CClusterItem[];
  needsReplenishment?: boolean;
  replenishmentItems?: { sku: string; name: string; qty: number; locationCode?: string }[];
}

export interface B2CCluster {
  id: string;
  clusterNo?: number;
  warehouseCode: string;
  createdAt: string;
  createdBy: string;
  status: "active" | "completed";
  completedAt?: string;
  bins: B2CClusterBin[];
  locationGroups: B2CClusterLocationGroup[];
  replenishmentBins?: number[];
}

export const BIN_COLORS = [
  { bg: "#ef4444", text: "#fff" }, { bg: "#f97316", text: "#fff" },
  { bg: "#eab308", text: "#000" }, { bg: "#22c55e", text: "#fff" },
  { bg: "#14b8a6", text: "#fff" }, { bg: "#3b82f6", text: "#fff" },
  { bg: "#8b5cf6", text: "#fff" }, { bg: "#ec4899", text: "#fff" },
  { bg: "#06b6d4", text: "#fff" }, { bg: "#84cc16", text: "#fff" },
  { bg: "#f59e0b", text: "#000" }, { bg: "#10b981", text: "#fff" },
  { bg: "#6366f1", text: "#fff" }, { bg: "#a855f7", text: "#fff" },
  { bg: "#d946ef", text: "#fff" }, { bg: "#0ea5e9", text: "#fff" },
  { bg: "#65a30d", text: "#fff" }, { bg: "#dc2626", text: "#fff" },
  { bg: "#ea580c", text: "#fff" }, { bg: "#ca8a04", text: "#fff" },
  { bg: "#16a34a", text: "#fff" }, { bg: "#0d9488", text: "#fff" },
  { bg: "#2563eb", text: "#fff" }, { bg: "#7c3aed", text: "#fff" },
  { bg: "#db2777", text: "#fff" },
];

export function binColor(binNo: number) {
  return BIN_COLORS[(binNo - 1) % 25];
}
