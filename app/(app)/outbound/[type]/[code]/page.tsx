"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { authHeaders } from "@/lib/api";
import { buildPickList, savePickList, loadPickList, type PickTask } from "@/lib/picking";
import { ChevronLeft, RefreshCw, CheckCircle2, Circle, MapPin } from "lucide-react";

const WAREHOUSE_CODE = "STOO1";

export default function OrderDetailPage() {
  const router = useRouter();
  const { type, code } = useParams<{ type: string; code: string }>();
  const [tasks, setTasks] = useState<PickTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customerCode, setCustomerCode] = useState("");

  async function build() {
    setLoading(true); setError("");
    // try to restore
    const saved = loadPickList(code);
    if (saved && saved.length > 0) { setTasks(saved); setLoading(false); return; }

    try {
      // fetch order + items in parallel
      const [detailRes, itemsRes] = await Promise.all([
        fetch(`/api/wms/shipping/${type}/${code}`, { headers: authHeaders() }),
        fetch(`/api/wms/shipping/${type}/items/${code}`, { headers: authHeaders() }),
      ]);
      const detailJson = await detailRes.json();
      const itemsJson  = await itemsRes.json().catch(() => null);

      const d = detailJson?.data ?? detailJson;
      const custCode = String(d?.customerCode ?? "");
      setCustomerCode(custCode);

      const rawItems: unknown[] =
        itemsJson?.data?.items ?? itemsJson?.data?.list ?? itemsJson?.data ??
        (Array.isArray(itemsJson) ? itemsJson : []);

      const list = await buildPickList(
        rawItems as Record<string, unknown>[],
        WAREHOUSE_CODE,
        custCode
      );

      if (list.length === 0) {
        setError("피킹 아이템이 없거나 재고 로케이션을 찾을 수 없습니다.");
      }
      savePickList(code, list);
      setTasks(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오더 로드 실패");
    }
    setLoading(false);
  }

  async function rebuild() {
    localStorage.removeItem(`pick_${code}`);
    await build();
  }

  useEffect(() => { build(); }, []); // eslint-disable-line

  const done   = tasks.filter((t) => t.status === "done").length;
  const total  = tasks.length;
  const pct    = total > 0 ? Math.round((done / total) * 100) : 0;
  const nextIdx = tasks.findIndex((t) => t.status === "pending");

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-5 py-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => router.back()} className="p-1 text-slate-400 hover:text-slate-700">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-slate-900 truncate">{code}</p>
          <p className="text-xs text-slate-500">피킹 목록</p>
        </div>
        <button onClick={rebuild} disabled={loading} className="p-2 text-slate-400 hover:text-slate-700">
          <RefreshCw className={`w-5 h-5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {/* Progress bar */}
      {!loading && total > 0 && (
        <div className="bg-white border-b border-slate-200 px-5 py-3">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
            <span>{done} / {total} 완료</span>
            <span className="font-semibold text-blue-600">{pct}%</span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      <main className="flex-1 overflow-y-auto p-4">
        {loading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
            <RefreshCw className="w-8 h-8 animate-spin" />
            <p className="text-sm">로케이션 자동 할당 중…</p>
          </div>
        )}

        {error && !loading && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm mb-4">{error}</div>
        )}

        {!loading && tasks.length > 0 && (
          <div className="space-y-2">
            {tasks.map((task) => (
              <button key={task.idx}
                onClick={() => router.push(`/outbound/${type}/${code}/pick/${task.idx}`)}
                disabled={task.status === "done"}
                className={`w-full rounded-2xl border p-4 flex items-center gap-3 text-left transition-all active:scale-[0.98] ${
                  task.status === "done"
                    ? "bg-slate-50 border-slate-100 opacity-60"
                    : "bg-white border-slate-200 shadow-sm hover:shadow-md"
                }`}>
                {task.status === "done"
                  ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                  : <Circle className="w-5 h-5 text-slate-300 flex-shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <MapPin className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                    <span className="font-mono text-sm font-semibold text-slate-900">{task.locationCode}</span>
                  </div>
                  <p className="text-xs text-slate-500 truncate">{task.productName}</p>
                  <p className="text-xs text-slate-400 font-mono">{task.sku}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-bold text-slate-900">{task.allocatedQty}</p>
                  <p className="text-xs text-slate-400">{task.unit ?? "EA"}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Bottom action */}
      {!loading && total > 0 && (
        <div className="bg-white border-t border-slate-200 p-4 flex-shrink-0">
          {done === total ? (
            <button onClick={() => router.push(`/outbound/${type}/${code}/complete`)}
              className="w-full h-14 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-2xl text-base transition-colors">
              패킹존 스캔 →
            </button>
          ) : (
            <button onClick={() => nextIdx >= 0 && router.push(`/outbound/${type}/${code}/pick/${nextIdx}`)}
              className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl text-base transition-colors">
              피킹 시작 ({nextIdx + 1}번 로케이션)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
