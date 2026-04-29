"use client";
import { useRouter } from "next/navigation";
import { getAuth, clearAuth } from "@/lib/auth";
import { PackageOpen, Truck, Boxes, LogOut } from "lucide-react";

const MODULES = [
  { label: "Inbound",   sub: "입고 처리",    icon: PackageOpen, href: "/inbound",   accent: "bg-blue-600",   light: "bg-blue-50 text-blue-700" },
  { label: "Outbound",  sub: "출고 / 피킹",  icon: Truck,       href: "/outbound",  accent: "bg-amber-600",  light: "bg-amber-50 text-amber-700" },
  { label: "Inventory", sub: "재고 조회",     icon: Boxes,       href: "/inventory", accent: "bg-teal-600",   light: "bg-teal-50 text-teal-700" },
];

export default function HomePage() {
  const router = useRouter();
  const user = getAuth();

  function logout() {
    clearAuth();
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
            <Truck className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-900 leading-none">WMS Mobile</p>
            <p className="text-xs text-slate-500 mt-0.5">{user?.name ?? user?.userId}</p>
          </div>
        </div>
        <button onClick={logout} className="p-2 text-slate-400 hover:text-slate-700 transition-colors">
          <LogOut className="w-5 h-5" />
        </button>
      </header>

      {/* Body */}
      <main className="flex-1 p-5">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-4">메뉴</p>
        <div className="space-y-3">
          {MODULES.map(({ label, sub, icon: Icon, href, accent }) => (
            <button key={href} onClick={() => router.push(href)}
              className="w-full bg-white border border-slate-200 rounded-2xl p-5 flex items-center gap-4 shadow-sm hover:shadow-md active:scale-[0.98] transition-all text-left">
              <div className={`w-12 h-12 rounded-xl ${accent} flex items-center justify-center flex-shrink-0`}>
                <Icon className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="text-base font-semibold text-slate-900">{label}</p>
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
