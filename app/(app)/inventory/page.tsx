"use client";
import { useRouter } from "next/navigation";
import { ChevronLeft, ArrowRight, Boxes, ClipboardList } from "lucide-react";

const DARK = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const GLASS = { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" };

export default function InventoryMenuPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen flex flex-col" style={DARK}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-base font-bold text-white">Inventory</p>
          <p className="text-[11px] text-slate-400">Select operation</p>
        </div>
      </header>

      <main className="flex-1 p-5 flex flex-col gap-4 pt-8">
        <button
          onClick={() => router.push("/inventory/simple-move")}
          className="rounded-2xl p-5 flex items-center gap-4 text-left active:opacity-75 transition-opacity"
          style={GLASS}
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(59,130,246,0.2)" }}
          >
            <Boxes className="w-6 h-6 text-blue-300" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-white text-base">Simple Move</p>
            <p className="text-xs text-slate-400 mt-0.5">Transfer inventory between locations</p>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-500" />
        </button>

        <button
          onClick={() => router.push("/inventory/cycle-count")}
          className="rounded-2xl p-5 flex items-center gap-4 text-left active:opacity-75 transition-opacity"
          style={GLASS}
        >
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(16,185,129,0.2)" }}
          >
            <ClipboardList className="w-6 h-6 text-emerald-300" />
          </div>
          <div className="flex-1">
            <p className="font-bold text-white text-base">Cycle Count</p>
            <p className="text-xs text-slate-400 mt-0.5">Verify inventory accuracy by location</p>
          </div>
          <ArrowRight className="w-5 h-5 text-slate-500" />
        </button>
      </main>
    </div>
  );
}
