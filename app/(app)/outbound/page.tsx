"use client";
import { useRouter } from "next/navigation";
import { Building2, User, Store, Globe, ChevronLeft } from "lucide-react";

const TYPES = [
  { key: "b2b", label: "B2B", sub: "Business to Business", icon: Building2, accent: "bg-blue-600" },
  { key: "b2c", label: "B2C", sub: "Business to Consumer", icon: User,      accent: "bg-purple-600" },
  { key: "b2s", label: "B2S", sub: "Business to Store",    icon: Store,     accent: "bg-amber-600" },
  { key: "b2e", label: "B2E", sub: "Business to eCommerce",icon: Globe,     accent: "bg-teal-600" },
];

export default function OutboundPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-5 py-4 flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1 text-slate-400 hover:text-slate-700">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div>
          <p className="text-base font-bold text-slate-900">Outbound</p>
          <p className="text-xs text-slate-500">출고 타입 선택</p>
        </div>
      </header>
      <main className="flex-1 p-5">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">Picking Type</p>
        <div className="space-y-3">
          {TYPES.map(({ key, label, sub, icon: Icon, accent }) => (
            <button key={key} onClick={() => router.push(`/outbound/${key}`)}
              className="w-full bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-4 shadow-sm hover:shadow-md active:scale-[0.98] transition-all text-left">
              <div className={`w-12 h-12 rounded-xl ${accent} flex items-center justify-center flex-shrink-0`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">{label} Picking</p>
                <p className="text-sm text-slate-500 mt-0.5">{sub}</p>
              </div>
              <span className="ml-auto text-slate-300 text-xl">›</span>
            </button>
          ))}
        </div>
      </main>
    </div>
  );
}
