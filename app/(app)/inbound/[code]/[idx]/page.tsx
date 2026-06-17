"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import {
  ChevronLeft, RefreshCw, Tag, Trash2, CheckCircle2,
  ChevronRight, Printer,
} from "lucide-react";
import { authHeaders } from "@/lib/api";
import { addStowTag, type PersistedStowTag } from "@/lib/stow-tags";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = {
  background: "rgba(255,255,255,0.06)",
  backdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.08)",
};

type Row = Record<string, unknown>;

type StowTag = {
  id: number;
  tagNo: number;
  barcodeValue: string;
  qty: number;
  lotNo: string;
  expireDate: string;
};

export default function InboundInspectPage() {
  const router = useRouter();
  const params = useParams();
  const code = String(params.code ?? "");
  const idx = Number(params.idx ?? 0);

  const [item, setItem] = useState<Row | null>(null);
  const [orderCustomerCode, setOrderCustomerCode] = useState("");
  const [loading, setLoading] = useState(true);

  const [tagQty, setTagQty] = useState("");
  const [lotNo, setLotNo] = useState("");
  const [expireDate, setExpireDate] = useState("");

  const [tags, setTags] = useState<StowTag[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [printTag, setPrintTag] = useState<StowTag | null>(null);
  const [printKey, setPrintKey] = useState(0);

  const qtyRef = useRef<HTMLInputElement>(null);

  /* ── auto-print ── */
  useEffect(() => {
    if (!printTag || printKey === 0) return;
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, [printKey]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── fetch item + existing tags ── */
  useEffect(() => {
    async function fetchItem() {
      setLoading(true);
      try {
        const res = await fetch(`/api/wms/receiving/items/${code}`, { headers: authHeaders() });
        const json = await res.json();
        const list: Row[] =
          Array.isArray(json?.data?.items) ? json.data.items :
          Array.isArray(json?.data?.list)  ? json.data.list :
          Array.isArray(json?.data)        ? json.data : [];
        const found = list[idx] ?? null;
        setItem(found);

        // If item doesn't carry customerCode, fetch order header for it
        if (found && !found.customerCode) {
          try {
            const orderRes = await fetch(`/api/wms/receiving/${code}`, { headers: authHeaders() });
            const orderJson = await orderRes.json().catch(() => null);
            const ord = orderJson?.data ?? orderJson;
            const cc = String(ord?.customerCode ?? ord?.customer?.customerCode ?? "");
            if (cc) setOrderCustomerCode(cc);
          } catch { /* ignore */ }
        }
        if (found) {
          const raw = String(found.expireDate ?? "");
          setLotNo(String(found.lotNo ?? ""));
          setExpireDate(raw.length >= 10 ? raw.slice(0, 10) : raw);

          const tagsRes = await fetch("/api/stow-tags");
          if (tagsRes.ok) {
            const allTags: PersistedStowTag[] = await tagsRes.json();
            const itemId = Number(found.receiveItemId ?? found.itemId ?? idx);
            const existing = allTags
              .filter((t) => t.orderCode === code && t.receiveItemId === itemId && !t.stowedAt)
              .sort((a, b) => a.tagNo - b.tagNo);
            setTags(existing.map((t) => ({
              id: t.id,
              tagNo: t.tagNo,
              barcodeValue: t.barcodeValue,
              qty: t.qty,
              lotNo: t.lotNo ?? "",
              expireDate: t.expireDate ?? "",
            })));
          }
        }
      } catch {}
      setLoading(false);
    }
    if (code) fetchItem();
  }, [code, idx]);

  const orderQty = item ? Number(item.orderQty ?? 0) : 0;
  const taggedQty = tags.reduce((s, t) => s + t.qty, 0);
  const remainingQty = orderQty - taggedQty;

  const sku = String(item?.productSku ?? item?.sku ?? "-");
  const productName = String(item?.productName ?? "-");
  const warehouseCode = String(item?.warehouseCode ?? "");
  const customerCode = String(item?.customerCode ?? orderCustomerCode ?? "");

  async function generateTag() {
    if (!item || !tagQty || Number(tagQty) <= 0 || generating) return;
    setGenerating(true);
    const tagNo = tags.length > 0 ? Math.max(...tags.map((t) => t.tagNo)) + 1 : 1;
    const itemId = String(item.receiveItemId ?? item.itemId ?? idx);
    const barcodeValue = `${code}::${itemId}-T${tagNo}`;

    const newTag: StowTag = {
      id: Date.now(),
      tagNo,
      barcodeValue,
      qty: Number(tagQty),
      lotNo,
      expireDate,
    };

    setTags((prev) => [...prev, newTag]);
    setTagQty("");
    qtyRef.current?.focus();

    await addStowTag({
      id: newTag.id,
      tagNo,
      orderCode: code,
      barcodeValue,
      qty: Number(tagQty),
      lotNo,
      expireDate,
      sku,
      productName,
      warehouseCode,
      warehouseCd: String(item.warehouseCd ?? item.warehouseId ?? warehouseCode),
      customerCode,
      receiveItemId: Number(item.receiveItemId ?? item.itemId ?? idx),
      itemCondition: String(item.itemCondition ?? item.condition ?? "GOOD"),
    });

    setPrintTag(newTag);
    setPrintKey((k) => k + 1);
    setGenerating(false);
  }

  async function deleteTag(tag: StowTag) {
    setDeletingId(tag.id);
    await fetch(`/api/stow-tags/${tag.id}`, { method: "DELETE" });
    setTags((prev) => prev.filter((t) => t.id !== tag.id));
    setDeletingId(null);
  }

  function complete() {
    if (!item) return;
    const storageKey = `wms_receiving_${code}`;
    let completed: string[] = [];
    try { completed = JSON.parse(localStorage.getItem(storageKey) ?? "[]"); } catch {}
    const key = String(item.productSku ?? item.sku ?? idx);
    if (!completed.includes(key)) completed.push(key);
    localStorage.setItem(storageKey, JSON.stringify(completed));
    router.push(`/inbound/${code}`);
  }

  const isAllTagged = orderQty > 0 && taggedQty >= orderQty;
  const canGenerate = Number(tagQty) > 0 && remainingQty > 0;

  /* ──────────── Loading ──────────── */
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={DARK}>
        <RefreshCw className="w-8 h-8 animate-spin text-slate-500" />
      </div>
    );
  }
  if (!item) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={DARK}>
        <p className="text-slate-400">Item not found</p>
        <button onClick={() => router.back()} className="text-blue-400 text-sm">← Back</button>
      </div>
    );
  }

  /* ──────────── Print styles (4×6 Zebra) ──────────── */
  const printContent = printTag ? `
    <div style="width:4in;min-height:6in;padding:5mm 6mm;font-family:'Courier New',monospace;box-sizing:border-box;display:flex;flex-direction:column;gap:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2.5px solid #000;padding-bottom:3mm;margin-bottom:3mm;">
        <div>
          <div style="font-size:13pt;font-weight:900;letter-spacing:0.04em;">STL STOW TAG</div>
          <div style="font-size:8.5pt;color:#444;margin-top:1mm;">${code}</div>
        </div>
        <div style="border:2px solid #000;border-radius:4px;padding:2mm 4mm;text-align:center;">
          <div style="font-size:7pt;color:#555;letter-spacing:0.08em;">TAG</div>
          <div style="font-size:18pt;font-weight:900;line-height:1;">${String(printTag.tagNo).padStart(2, "0")}</div>
        </div>
      </div>
      <div id="bc-container" style="display:flex;justify-content:center;margin-bottom:3mm;border-bottom:1px solid #ccc;padding-bottom:3mm;">
        <svg id="barcode"></svg>
      </div>
      <div style="text-align:center;font-size:15pt;font-weight:900;letter-spacing:0.06em;margin-bottom:1.5mm;word-break:break-all;">${sku}</div>
      <div style="text-align:center;font-size:9pt;color:#222;margin-bottom:4mm;line-height:1.35;border-bottom:1px solid #ccc;padding-bottom:3mm;">${productName}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;background:#000;color:#fff;padding:3mm 5mm;margin-bottom:3mm;border-radius:2px;">
        <span style="font-size:11pt;font-weight:700;letter-spacing:0.08em;">QTY</span>
        <span style="font-size:26pt;font-weight:900;line-height:1;">${printTag.qty}</span>
      </div>
      <div style="border:1.5px solid #000;border-radius:2px;overflow:hidden;margin-bottom:3mm;">
        ${printTag.lotNo ? `<div style="display:flex;"><div style="width:22mm;flex-shrink:0;background:#f0f0f0;padding:2mm 3mm;font-size:7.5pt;font-weight:700;letter-spacing:0.06em;color:#333;border-right:1.5px solid #000;">LOT NO</div><div style="flex:1;padding:2mm 3mm;font-size:10.5pt;font-weight:700;">${printTag.lotNo}</div></div>` : ""}
        ${printTag.expireDate ? `<div style="display:flex;border-top:${printTag.lotNo ? "1px solid #ccc" : "none"};"><div style="width:22mm;flex-shrink:0;background:#f0f0f0;padding:2mm 3mm;font-size:7.5pt;font-weight:700;letter-spacing:0.06em;color:#333;border-right:1.5px solid #000;">EXPIRE</div><div style="flex:1;padding:2mm 3mm;font-size:10.5pt;font-weight:700;">${printTag.expireDate.slice(0, 10)}</div></div>` : ""}
        ${customerCode ? `<div style="display:flex;border-top:1px solid #ccc;"><div style="width:22mm;flex-shrink:0;background:#f0f0f0;padding:2mm 3mm;font-size:7.5pt;font-weight:700;letter-spacing:0.06em;color:#333;border-right:1.5px solid #000;">CUSTOMER</div><div style="flex:1;padding:2mm 3mm;font-size:10.5pt;font-weight:700;">${customerCode}</div></div>` : ""}
      </div>
      <div style="margin-top:auto;border-top:1px solid #ccc;padding-top:2mm;display:flex;justify-content:space-between;font-size:7.5pt;color:#888;">
        <span>CTK USA, INC.</span><span>${new Date().toLocaleDateString("en-US")}</span>
      </div>
    </div>
  ` : "";

  /* ──────────── Render ──────────── */
  return (
    <>
      {/* 프린트 숨김 영역 */}
      {printTag && (
        <div id="stow-print-area" key={printKey} dangerouslySetInnerHTML={{ __html: printContent }} />
      )}

      <style>{`
        @media print {
          @page { size: 4in 6in; margin: 0; }
          body > * { visibility: hidden; }
          #stow-print-area, #stow-print-area * { visibility: visible; }
          #stow-print-area { position: fixed; top: 0; left: 0; width: 4in; height: 6in; }
        }
        @media screen { #stow-print-area { display: none; } }
      `}</style>

      <div className="min-h-screen flex flex-col" style={DARK}>
        {/* Header */}
        <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
          <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white">
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white">Inspect Item</p>
            <p className="text-xs text-slate-500 font-mono truncate">{code}</p>
          </div>
        </header>

        <main className="flex-1 px-4 pt-4 pb-8 space-y-3 overflow-y-auto">
          {/* Item info card */}
          <div className="rounded-2xl p-4" style={GLASS}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-white font-mono truncate">{sku}</p>
                <p className="text-xs text-slate-400 mt-1 leading-snug">{productName}</p>
                <p className="text-xs text-slate-500 font-mono mt-1">{String(item.barcode ?? item.ean ?? "")}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-xs text-slate-500">Tagged / Total</p>
                <p className={`text-xl font-bold ${isAllTagged ? "text-green-400" : "text-white"}`}>
                  {taggedQty} <span className="text-slate-500 text-sm">/ {orderQty}</span>
                </p>
                <p className={`text-xs mt-0.5 ${remainingQty <= 0 ? "text-green-400" : "text-amber-400"}`}>
                  {remainingQty <= 0 ? "Done" : `${remainingQty} remaining`}
                </p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: orderQty > 0 ? `${Math.min(100, (taggedQty / orderQty) * 100)}%` : "0%",
                  background: isAllTagged ? "#4ade80" : "#3b82f6",
                }}
              />
            </div>
          </div>

          {/* LOT / EXP (읽기전용 표시) */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl p-3" style={GLASS}>
              <p className="text-xs text-slate-500 mb-1">LOT NO</p>
              <p className="text-sm font-mono font-semibold text-slate-200">{lotNo || "-"}</p>
            </div>
            <div className="rounded-xl p-3" style={GLASS}>
              <p className="text-xs text-slate-500 mb-1">EXPIRE</p>
              <p className="text-sm font-mono font-semibold text-slate-200">{expireDate || "-"}</p>
            </div>
          </div>

          {/* Generate Tag form */}
          {!isAllTagged && (
            <div className="rounded-2xl p-4 space-y-4" style={{ ...GLASS, border: "1px solid rgba(59,130,246,0.3)" }}>
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-blue-400" />
                <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider">Generate Stow Tag</p>
              </div>

              {/* TAG QTY */}
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">
                  TAG QTY <span className="text-red-400">*</span>
                  <span className="text-slate-500 ml-2">(remaining: {remainingQty})</span>
                </label>
                <input
                  ref={qtyRef}
                  type="number"
                  inputMode="numeric"
                  value={tagQty}
                  onChange={(e) => setTagQty(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") generateTag(); }}
                  placeholder={`1 – ${remainingQty}`}
                  min={1}
                  max={remainingQty}
                  className="w-full rounded-xl px-4 py-3 text-white font-semibold text-lg outline-none transition-colors"
                  style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(59,130,246,0.4)" }}
                />
              </div>

              <button
                onClick={generateTag}
                disabled={!canGenerate || generating}
                className="w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40"
                style={{ background: canGenerate ? "#3b82f6" : "rgba(255,255,255,0.06)", color: "#fff" }}
              >
                {generating
                  ? <RefreshCw className="w-4 h-4 animate-spin" />
                  : <Tag className="w-4 h-4" />
                }
                Generate &amp; Print Tag
              </button>
            </div>
          )}

          {/* Tag list */}
          {tags.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-wide px-1">Generated Stow Tags</p>
              {tags.map((tag) => (
                <div
                  key={tag.id}
                  className="rounded-2xl px-4 py-3 flex items-center gap-3"
                  style={GLASS}
                >
                  {/* Tag number badge */}
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)" }}>
                    <span className="text-blue-300 font-bold text-sm">{String(tag.tagNo).padStart(2, "0")}</span>
                  </div>
                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-slate-400 truncate">{tag.barcodeValue}</p>
                    <p className="text-sm font-bold text-white mt-0.5">QTY: {tag.qty}</p>
                  </div>
                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => { setPrintTag(tag); setPrintKey((k) => k + 1); }}
                      className="p-2 rounded-lg text-slate-400 active:text-white transition-colors"
                      style={{ background: "rgba(255,255,255,0.06)" }}
                    >
                      <Printer className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => deleteTag(tag)}
                      disabled={deletingId === tag.id}
                      className="p-2 rounded-lg text-slate-500 active:text-red-400 transition-colors disabled:opacity-40"
                      style={{ background: "rgba(255,255,255,0.06)" }}
                    >
                      {deletingId === tag.id
                        ? <RefreshCw className="w-4 h-4 animate-spin" />
                        : <Trash2 className="w-4 h-4" />
                      }
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Complete Inspection button */}
          <button
            onClick={complete}
            className="w-full py-4 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            style={isAllTagged
              ? { background: "#16a34a", color: "#fff" }
              : { background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", color: "#94a3b8" }
            }
          >
            {isAllTagged
              ? <><CheckCircle2 className="w-5 h-5" /> Complete Inspection</>
              : <><ChevronRight className="w-5 h-5" /> Skip &amp; Continue</>
            }
          </button>
        </main>
      </div>
    </>
  );
}
