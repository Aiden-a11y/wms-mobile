"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, RefreshCw, ScanLine, MapPin, Tag, AlertCircle } from "lucide-react";
import type { PersistedStowTag } from "@/lib/stow-tags";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = {
  background: "rgba(255,255,255,0.06)",
  backdropFilter: "blur(16px)",
  border: "1px solid rgba(255,255,255,0.08)",
};

export default function StowListPage() {
  const router = useRouter();
  const [tags, setTags] = useState<PersistedStowTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [scan, setScan] = useState("");
  const [scanError, setScanError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function loadTags() {
    setLoading(true);
    try {
      const res = await fetch("/api/stow-tags?pending=true");
      if (res.ok) {
        const data: PersistedStowTag[] = await res.json();
        setTags(data);
      }
    } catch {}
    setLoading(false);
  }

  useEffect(() => { loadTags(); }, []);

  function handleScan() {
    const v = scan.trim();
    if (!v) return;
    setScanError("");
    const match = tags.find((t) => t.barcodeValue === v);
    if (match) {
      setScan("");
      router.push(`/inbound/stow?id=${match.id}`);
      return;
    }
    // barcode not in local list → pass to stow page to try API
    setScan("");
    router.push(`/inbound/stow?barcode=${encodeURIComponent(v)}`);
  }

  // Group by orderCode
  const groups = tags.reduce<Record<string, PersistedStowTag[]>>((acc, tag) => {
    (acc[tag.orderCode] ??= []).push(tag);
    return acc;
  }, {});

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <p className="text-base font-bold text-white flex-1">Stow Process</p>
        <button onClick={loadTags} disabled={loading} className="p-1 text-slate-400 active:text-white">
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      <main className="flex-1 px-4 pt-4 pb-8 space-y-3 overflow-y-auto">
        {/* Scan input */}
        <div className="rounded-2xl p-4" style={GLASS}>
          <div className="flex items-center gap-2 mb-3">
            <ScanLine className="w-4 h-4 text-blue-400" />
            <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider">Scan Stow Tag</p>
          </div>
          <input
            ref={inputRef}
            type="text"
            value={scan}
            onChange={(e) => { setScan(e.target.value); setScanError(""); }}
            onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }}
            placeholder="Scan stow tag barcode..."
            autoFocus
            className="w-full bg-transparent border-0 border-b border-slate-600 focus:border-blue-500 outline-none text-white text-sm py-2 placeholder:text-slate-600 transition-colors"
          />
          {scanError && (
            <div className="flex items-center gap-1.5 text-xs text-red-400 mt-2">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{scanError}
            </div>
          )}
        </div>

        {/* Pending count badge */}
        {!loading && tags.length > 0 && (
          <div className="flex items-center gap-2 px-1">
            <Tag className="w-3.5 h-3.5 text-amber-400" />
            <p className="text-xs font-semibold text-amber-400">{tags.length} pending tag{tags.length !== 1 ? "s" : ""}</p>
          </div>
        )}

        {/* Skeleton */}
        {loading && (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 rounded-2xl animate-pulse" style={{ background: "rgba(255,255,255,0.04)" }} />
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && tags.length === 0 && (
          <div className="text-center py-16">
            <p className="text-slate-500 text-sm">No pending stow tags</p>
          </div>
        )}

        {/* Tag groups */}
        {!loading && Object.entries(groups).map(([orderCode, orderTags]) => (
          <div key={orderCode} className="rounded-2xl overflow-hidden" style={GLASS}>
            {/* Order header */}
            <div
              className="px-4 py-2.5 flex items-center gap-2"
              style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.04)" }}
            >
              <Tag className="w-3.5 h-3.5 text-slate-400" />
              <span className="font-mono text-xs font-semibold text-slate-300 flex-1 truncate">{orderCode}</span>
              <span className="text-xs text-slate-500 flex-shrink-0">
                {orderTags.length} tag{orderTags.length !== 1 ? "s" : ""}
              </span>
            </div>

            {/* Tags */}
            <div>
              {orderTags.map((tag, i) => (
                <div
                  key={tag.id}
                  className="flex items-center gap-3 px-4 py-3"
                  style={i < orderTags.length - 1 ? { borderBottom: "1px solid rgba(255,255,255,0.05)" } : {}}
                >
                  {/* Tag number */}
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)" }}
                  >
                    <span className="text-blue-300 font-bold text-xs">T{tag.tagNo}</span>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-sm font-bold text-white">{tag.sku}</span>
                      <span className="text-xs font-bold text-blue-400">×{tag.qty}</span>
                    </div>
                    <div className="flex gap-2 mt-0.5 text-xs text-slate-500">
                      {tag.lotNo && <span>LOT: {tag.lotNo}</span>}
                      {tag.expireDate && <span>EXP: {tag.expireDate.slice(0, 10)}</span>}
                      {!tag.lotNo && !tag.expireDate && (
                        <span className="truncate">{tag.productName}</span>
                      )}
                    </div>
                  </div>

                  {/* Stow button */}
                  <button
                    onClick={() => router.push(`/inbound/stow?id=${tag.id}`)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl flex-shrink-0 active:scale-95 transition-all"
                    style={{ background: "rgba(59,130,246,0.2)", border: "1px solid rgba(59,130,246,0.4)", color: "#93c5fd" }}
                  >
                    <MapPin className="w-3.5 h-3.5" />
                    Stow
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
