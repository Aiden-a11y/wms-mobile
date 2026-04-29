"use client";
import { useRouter } from "next/navigation";
import { ChevronLeft, Construction } from "lucide-react";

export default function InventoryPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-5 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1 text-slate-400 hover:text-slate-700">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <p className="text-base font-bold text-slate-900">Inventory</p>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center gap-4 text-slate-400 p-6">
        <Construction className="w-12 h-12" />
        <p className="text-base font-semibold">준비 중</p>
        <p className="text-sm text-center">Inventory 조회 기능은 추후 구현 예정입니다</p>
      </main>
    </div>
  );
}
