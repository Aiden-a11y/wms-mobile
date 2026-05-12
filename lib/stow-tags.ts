export type PersistedStowTag = {
  id: number;
  tagNo: number;
  orderCode: string;
  barcodeValue: string;
  qty: number;
  lotNo: string;
  expireDate: string;
  sku: string;
  productName: string;
  warehouseCode: string;
  warehouseCd: string;
  customerCode: string;
  receiveItemId: number;
  itemCondition: string;
  stowedAt?: string;
};

export async function addStowTag(tag: PersistedStowTag): Promise<void> {
  await fetch("/api/stow-tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tag),
  });
}
