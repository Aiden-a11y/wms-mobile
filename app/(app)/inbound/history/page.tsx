"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, RefreshCw, Search, MapPin, Package, Boxes, Loader2, ChevronDown,
} from "lucide-react";
import { authHeaders } from "@/lib/api";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" };
const INPUT = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(59,130,246,0.4)" };

const STATUS: Record<string, string> = { AA: "Pre-Alert", CA: "Processing", DA: "Complete", EA: "Hold" };

interface Assign {
  orderCode: string; customer: string; statusName: string;
  sku: string; productName: string;
  location: string; qty: number; remain: number; lot: string; exp: string; condition: string;
}

/* ── parse helpers ── */
const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => String(v ?? "");
function arrOf(json: unknown): Record<string, unknown>[] {
  const j = json as Record<string, unknown>;
  const d = (j?.data ?? j) as Record<string, unknown>;
  if (Array.isArray((d as { list?: unknown })?.list)) return (d as { list: Record<string, unknown>[] }).list;
  if (Array.isArray((d as { items?: unknown })?.items)) return (d as { items: Record<string, unknown>[] }).items;
  if (Array.isArray(d)) return d as unknown as Record<string, unknown>[];
  if (Array.isArray((j as { list?: unknown })?.list)) return (j as { list: Record<string, unknown>[] }).list;
  if (Array.isArray(json)) return json as Record<string, unknown>[];
  return [];
}
function buildLoc(r: Record<string, unknown>): string {
  const direct = r.locationCode ?? r.location ?? r.locationNo ?? r.locCode;
  if (direct) return String(direct);
  const parts = [r.zoneName ?? r.zone, r.aisleName ?? r.aisle, r.bayName ?? r.bay, r.levelName ?? r.level, r.positionName ?? r.position]
    .map((v) => String(v ?? "")).filter(Boolean);
  return parts.length ? parts.join(" / ") : "";
}
const NESTED_KEYS = ["assignList", "locationList", "stowList", "assignments", "assignmentList", "details", "detailList", "receiveLocationList", "locations", "childList", "subList", "assignLocationList"];
function extractAssignments(item: Record<string, unknown>): Record<string, unknown>[] {
  for (const k of NESTED_KEYS) {
    const v = (item as Record<string, unknown>)[k];
    if (Array.isArray(v) && v.length) return v as Record<string, unknown>[];
  }
  // fallback: first array-of-objects property
  for (const v of Object.values(item)) {
    if (Array.isArray(v) && v.length && typeof v[0] === "object" && v[0] !== null) return v as Record<string, unknown>[];
  }
  return [];
}

export default function StowHistoryPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Assign[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [debug, setDebug] = useState("");
  const [q, setQ] = useState("");
  const [openOrder, setOpenOrder] = useState<string | null>(null);

  async function load() {
    setLoading(true); setRows([]); setDebug(""); setProgress({ done: 0, total: 0 });
    try {
      // 1) in-progress receiving orders (status != DA complete)
      const listRes = await fetch("/api/wms/receiving/list", {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ page: 1, limit: 200 }),
      });
      const orders = arrOf(await listRes.json())
        .map((o) => ({
          code: str(o.orderCode ?? o.receivingCode ?? o.code),
          customer: str(o.customerName ?? o.customerCode ?? ""),
          status: str(o.status ?? o.statusCode ?? ""),
        }))
        .filter((o) => o.code && o.status !== "DA")  // exclude completed
        .slice(0, 40);

      setProgress({ done: 0, total: orders.length });
      const acc: Assign[] = [];
      let sampleKeys = "";

      for (let i = 0; i < orders.length; i++) {
        const o = orders[i];
        try {
          const r = await fetch(`/api/wms/receiving/items/${o.code}`, { headers: authHeaders() });
          const items = arrOf(await r.json());
          for (const it of items) {
            const sku = str(it.productSku ?? it.sku);
            const name = str(it.productName ?? it.itemName);
            const assigns = extractAssignments(it);
            if (assigns.length === 0 && !sampleKeys) sampleKeys = Object.keys(it).join(",");
            for (const a of assigns) {
              const loc = buildLoc(a);
              if (!loc) continue;
              acc.push({
                orderCode: o.code, customer: o.customer, statusName: STATUS[o.status] ?? o.status,
                sku, productName: name,
                location: loc,
                qty: num(a.qty ?? a.assignQty ?? a.receiveQty ?? a.stowQty ?? a.assignedQty),
                remain: num(a.remainQty ?? a.remain ?? a.unassignedQty),
                lot: str(a.lotNo ?? a.lot ?? it.lotNo),
                exp: str(a.expireDate ?? a.expiryDate ?? it.expireDate).slice(0, 10),
                condition: str(a.itemCondition ?? a.condition ?? "GOOD"),
              });
            }
          }
        } catch { /* skip order */ }
        setProgress({ done: i + 1, total: orders.length });
        setRows([...acc]);
      }

      if (acc.length === 0) {
        setDebug(`No assignments parsed from ${orders.length} in-progress orders.` + (sampleKeys ? `\nItem fields: ${sampleKeys}` : ""));
      }
    } catch (e) {
      setDebug(e instanceof Error ? e.message : "Load failed");
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const query = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (!query ? rows : rows.filter((r) => r.sku.toLowerCase().includes(query) || r.productName.toLowerCase().includes(query))),
    [rows, query],
  );

  // group by order for default view
  const byOrder = useMemo(() => {
    const m = new Map<string, Assign[]>();
    for (const r of filtered) { if (!m.has(r.orderCode)) m.set(r.orderCode, []); m.get(r.orderCode)!.push(r); }
    return [...m.entries()];
  }, [filtered]);

  // group by location for SKU search
  const placements = useMemo(() => {
    if (!query) return null;
    const m = new Map<string, { qty: number; remain: number; order: string; lot: string; exp: string }>();
    for (const r of filtered) {
      const k = `${r.location}__${r.orderCode}`;
      const cur = m.get(k) ?? { qty: 0, remain: 0, order: r.orderCode, lot: r.lot, exp: r.exp };
      cur.qty += r.qty; cur.remain += r.remain;
      m.set(k, cur);
    }
    return [...m.entries()].map(([k, v]) => ({ location: k.split("__")[0], ...v }));
  }, [filtered, query]);

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white"><ChevronLeft className="w-6 h-6" /></button>
        <div className="flex-1">
          <p className="text-base font-bold text-white">Assignments</p>
          <p className="text-[11px] text-slate-400">In-progress orders · live</p>
        </div>
        <button onClick={load} disabled={loading} className="p-1 text-slate-400 active:text-white"><RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} /></button>
      </header>

      <div className="px-5 py-3 flex-shrink-0">
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={INPUT}>
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Search SKU / product → where it's placed"
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-slate-500" autoComplete="off" />
          {q && <button onClick={() => setQ("")} className="text-slate-500 text-xs">clear</button>}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-5 pb-8">
        {loading && (
          <div className="flex flex-col items-center gap-3 py-10 text-slate-400">
            <Loader2 className="w-7 h-7 animate-spin" />
            <p className="text-sm">Loading assignments…</p>
            {progress.total > 0 && <p className="text-xs text-slate-500">{progress.done} / {progress.total} orders</p>}
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div className="rounded-2xl p-6 text-center" style={GLASS}>
            <Boxes className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <p className="text-sm text-slate-300 font-semibold">No assignments found</p>
            {debug && <p className="mt-2 text-[10px] text-slate-500 font-mono break-all whitespace-pre-wrap leading-relaxed">{debug}</p>}
          </div>
        )}

        {/* SKU search → placement summary */}
        {!loading && query && placements && placements.length > 0 && (
          <div className="mb-5">
            <p className="text-[11px] font-semibold text-emerald-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Placed at ({placements.length})
            </p>
            <div className="flex flex-col gap-2">
              {placements.map((p, i) => (
                <div key={i} className="rounded-xl p-3.5 flex items-center gap-3" style={{ ...GLASS, borderColor: "rgba(16,185,129,0.3)" }}>
                  <MapPin className="w-5 h-5 text-emerald-400 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-mono text-sm text-white">{p.location}</p>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <Tag>{p.order}</Tag>
                      {p.lot && <Tag>LOT {p.lot}</Tag>}
                      {p.remain > 0 && <Tag>remain {p.remain}</Tag>}
                    </div>
                  </div>
                  <span className="text-lg font-bold text-white flex-shrink-0">{p.qty}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && query && filtered.length === 0 && rows.length > 0 && (
          <div className="rounded-2xl p-6 text-center" style={GLASS}>
            <p className="text-sm text-slate-300 font-semibold">Not assigned yet</p>
            <p className="text-xs text-slate-500 mt-1">No in-progress assignment for &quot;{q}&quot;.</p>
          </div>
        )}

        {/* default: grouped by order */}
        {!loading && !query && byOrder.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">In-progress orders · {byOrder.length}</p>
            {byOrder.map(([code, list]) => {
              const open = openOrder === code;
              return (
                <div key={code} className="rounded-xl overflow-hidden" style={GLASS}>
                  <button onClick={() => setOpenOrder(open ? null : code)} className="w-full p-3.5 flex items-center gap-3 text-left">
                    <Package className="w-4 h-4 text-blue-300 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-sm text-white truncate">{code}</p>
                      <p className="text-xs text-slate-400 truncate">{list[0]?.customer} · {list[0]?.statusName}</p>
                    </div>
                    <span className="text-xs text-slate-400">{list.length} loc</span>
                    <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open && (
                    <div className="px-3 pb-3 flex flex-col gap-1.5">
                      {list.map((r, i) => (
                        <div key={i} className="rounded-lg p-2.5" style={{ background: "rgba(255,255,255,0.04)" }}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-white flex-1 truncate">{r.sku}</span>
                            <span className="text-xs font-bold text-white">{r.qty}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px]">
                            <MapPin className="w-3 h-3 text-emerald-400" />
                            <span className="font-mono text-emerald-300">{r.location}</span>
                            {r.remain > 0 && <span className="text-amber-400 ml-auto">remain {r.remain}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* SKU search → matching rows list */}
        {!loading && query && filtered.length > 0 && (
          <>
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mt-5 mb-2">Matching · {filtered.length}</p>
            <div className="flex flex-col gap-2">
              {filtered.map((r, i) => (
                <div key={i} className="rounded-xl p-3.5" style={GLASS}>
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-blue-300 flex-shrink-0" />
                    <span className="font-mono text-sm font-semibold text-white flex-1 truncate">{r.sku}</span>
                    <span className="text-sm font-bold text-white">× {r.qty}</span>
                  </div>
                  {r.productName && <p className="text-xs text-slate-400 mt-0.5 truncate">{r.productName}</p>}
                  <div className="flex items-center gap-2 mt-2 text-xs">
                    <span className="font-mono text-slate-500">{r.orderCode}</span>
                    <span className="text-slate-600">→</span>
                    <span className="font-mono text-emerald-300 flex items-center gap-1"><MapPin className="w-3 h-3" />{r.location}</span>
                    {r.remain > 0 && <span className="text-amber-400 ml-auto">remain {r.remain}</span>}
                  </div>
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {r.lot && <Tag>LOT {r.lot}</Tag>}
                    {r.exp && <Tag>EXP {r.exp}</Tag>}
                    <Tag>{r.statusName}</Tag>
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
