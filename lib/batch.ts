export interface Batch {
  id: string;
  fingerprint: string;
  orders: { orderCode: string; customerCode: string }[];
  skuList: { sku: string; name: string; qty: number }[];
  orderCount: number;
  type: string;
  warehouseCode: string;
  createdAt: string;
  createdBy: string;
}
