"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, RefreshCw, Search, MapPin, Package, Clock, Boxes, Loader2,
} from "lucide-react";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" };
const INPUT = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(59,130,246,0.4)" };

interface Entry {
  id: string; at: string; sku: string; productName?: string; qty: number;
  locationCode: string; warehouseCode?: string; customerCode?: string;
  orderCode?: string; lotNo?: string; expireDate?: string;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const diff = (now - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function StowHistoryPage() {
  const router = useRouter();
  const [all, setAll] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/stow-history?limit=300");
      const json = await res.json().catch(() => []);
      setAll(Array.isArray(json) ? json : []);
    } catch { setAll([]); }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!query) return all;
    return all.filter(
      (e) =>
        String(e.sku ?? "").toLowerCase().includes(query) ||
        String(e.productName ?? "").toLowerCase().includes(query),
    );
  }, [all, query]);

  // when searching a SKU → group current placements by location
  const placements = useMemo(() => {
    if (!query) return null;
    const map = new Map<string, { qty: number; lot: string; exp: string; last: string; name: string }>();
    for (const e of filtered) {
      const cur = map.get(e.locationCode) ?? { qty: 0, lot: e.lotNo ?? "", exp: e.expireDate ?? "", last: e.at, name: e.productName ?? "" };
      cur.qty += Number(e.qty) || 0;
      if (new Date(e.at) > new Date(cur.last)) cur.last = e.at;
      map.set(e.locationCode, cur);
    }
    return [...map.entries()].sort((a, b) => new Date(b[1].last).getTime() - new Date(a[1].last).getTime());
  }, [filtered, query]);

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <p className="text-base font-bold text-white flex-1">Stow History</p>
        <button onClick={load} disabled={loading} className="p-1 text-slate-400 active:text-white">
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {/* search */}
      <div className="px-5 py-3 flex-shrink-0">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={INPUT}>
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search SKU / product to see where it's placed"
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-slate-500"
            autoComplete="off"
          />
          {q && <button onClick={() => setQ("")} className="text-slate-500 text-xs">clear</button>}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-5 pb-8">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-12 text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin" />
            <p className="text-sm">Loading history…</p>
          </div>
        )}

        {!loading && all.length === 0 && (
          <div className="rounded-2xl p-8 text-center" style={GLASS}>
            <Boxes className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-300 font-semibold">No stow history yet</p>
            <p className="text-xs text-slate-500 mt-1">Completed stows will appear here.</p>
          </div>
        )}

        {/* SKU search → placement summary */}
        {!loading && query && placements && placements.length > 0 && (
          <div className="mb-5">
            <p className="text-[11px] font-semibold text-emerald-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Already placed at
            </p>
            <div className="flex flex-col gap-2">
              {placements.map(([loc, info]) => (
                <div key={loc} className="rounded-xl p-3.5 flex items-center gap-3" style={{ ...GLASS, borderColor: "rgba(16,185,129,0.3)" }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "rgba(16,185,129,0.15)" }}>
                    <MapPin className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-white">{loc}</p>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      {info.lot && <Tag>LOT {info.lot}</Tag>}
                      {info.exp && <Tag>EXP {info.exp}</Tag>}
                      <Tag>{fmtTime(info.last)}</Tag>
                    </div>
                  </div>
                  <span className="text-lg font-bold text-white flex-shrink-0">{info.qty}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && query && placements && placements.length === 0 && all.length > 0 && (
          <div className="rounded-2xl p-6 text-center mb-5" style={GLASS}>
            <p className="text-sm text-slate-300 font-semibold">Not stowed yet</p>
            <p className="text-xs text-slate-500 mt-1">No record of &quot;{q}&quot; being placed.</p>
          </div>
        )}

        {/* timeline */}
        {!loading && filtered.length > 0 && (
          <>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
              {query ? "Matching stows" : "Recent stows"} · {filtered.length}
            </p>
            <div className="flex flex-col gap-2">
              {filtered.map((e) => (
                <div key={e.id} className="rounded-xl p-3.5" style={GLASS}>
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-blue-300 flex-shrink-0" />
                    <span className="font-mono text-sm font-semibold text-white flex-1 truncate">{e.sku}</span>
                    <span className="text-sm font-bold text-white">× {e.qty}</span>
                  </div>
                  {e.productName && <p className="text-xs text-slate-400 mt-0.5 truncate">{e.productName}</p>}
                  <div className="flex items-center gap-2 mt-2 text-xs">
                    {e.orderCode && <span className="font-mono text-slate-500">{e.orderCode}</span>}
                    <span className="text-slate-600">→</span>
                    <span className="font-mono text-emerald-300 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />{e.locationCode}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    {e.lotNo && <Tag>LOT {e.lotNo}</Tag>}
                    {e.expireDate && <Tag>EXP {e.expireDate}</Tag>}
                    {e.customerCode && <Tag>{e.customerCode}</Tag>}
                    <span className="text-[10px] text-slate-500 flex items-center gap-1 ml-auto">
                      <Clock className="w-3 h-3" />{fmtTime(e.at)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="text-[10px] font-mono px-1.5 py-0.5 rounded text-slate-300" style={{ background: "rgba(255,255,255,0.08)" }}>{children}</span>;
}
