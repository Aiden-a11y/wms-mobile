"use client";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getAuth, clearAuth } from "@/lib/auth";
import { PackageOpen, Truck, Boxes, LogOut } from "lucide-react";

const MODULES = [
  {
    label: "Inbound",
    sub: "Stow Process",
    icon: PackageOpen,
    href: "/inbound",
    color: "#3B82F6",
    bg: "rgba(59,130,246,0.15)",
  },
  {
    label: "Outbound",
    sub: "Outbound / Picking",
    icon: Truck,
    href: "/outbound",
    color: "#F59E0B",
    bg: "rgba(245,158,11,0.15)",
  },
  {
    label: "Inventory",
    sub: "Inventory Lookup",
    icon: Boxes,
    href: "/inventory",
    color: "#14B8A6",
    bg: "rgba(20,184,166,0.15)",
  },
];

export default function HomePage() {
  const router = useRouter();
  const user = getAuth();
  const displayName = user?.name ?? user?.userId ?? "User";

  function logout() {
    clearAuth();
    router.replace("/login");
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" }}
    >
      {/* Header */}
      <header className="px-5 pt-10 pb-6 flex items-center justify-between flex-shrink-0">
        <Image src="/stl-logo.png" alt="STL Logo" width={80} height={32} className="object-contain" />
        <button
          onClick={logout}
          className="p-2 rounded-xl transition-colors"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <LogOut className="w-4 h-4 text-slate-400" />
        </button>
      </header>

      {/* Greeting */}
      <div className="px-5 pb-8">
        <p className="text-2xl font-bold text-white">Hello, {displayName}</p>
        <p className="text-sm text-slate-400 mt-1">Stay safe today</p>
      </div>

      {/* Modules */}
      <main className="flex-1 px-5 pb-8">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-4">Menu</p>
        <div className="space-y-3">
          {MODULES.map(({ label, sub, icon: Icon, href, color, bg }) => (
            <button
              key={href}
              onClick={() => router.push(href)}
              className="w-full rounded-2xl p-5 flex items-center gap-4 active:scale-[0.98] transition-all text-left"
              style={{
                background: "rgba(255,255,255,0.06)",
                backdropFilter: "blur(16px)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: bg }}
              >
                <Icon className="w-6 h-6" style={{ color }} />
              </div>
              <div>
                <p className="text-base font-semibold text-white">{label}</p>
                <p className="text-sm text-slate-400 mt-0.5">{sub}</p>
              </div>
              <span className="ml-auto text-slate-500 text-xl">›</span>
            </button>
          ))}
        </div>
      </main>

      <p className="text-center text-slate-700 text-xs pb-6">STOO Logistics · WMS Mobile v1.0</p>
    </div>
  );
}
