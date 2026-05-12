"use client";
import { useRouter } from "next/navigation";
import { ChevronLeft, Construction } from "lucide-react";

const DARK_BG = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };

export default function InventoryPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen flex flex-col" style={DARK_BG}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <p className="text-base font-bold text-white">Inventory</p>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center gap-4 p-6">
        <Construction className="w-12 h-12 text-slate-500" />
        <p className="text-base font-semibold text-slate-300">Coming Soon</p>
        <p className="text-sm text-center text-slate-500">Inventory lookup coming soon</p>
      </main>
    </div>
  );
}
