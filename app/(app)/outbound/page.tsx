"use client";
import { useRouter } from "next/navigation";
import { Building2, User, Store, Globe, ChevronLeft, PackageCheck } from "lucide-react";

const TYPES = [
  { key: "b2b", label: "B2B", sub: "Business to Business",  icon: Building2,   color: "#3B82F6", bg: "rgba(59,130,246,0.15)" },
  { key: "b2c", label: "B2C", sub: "Business to Consumer",  icon: User,        color: "#A855F7", bg: "rgba(168,85,247,0.15)" },
  { key: "b2s", label: "B2S", sub: "Business to Store",     icon: Store,       color: "#F59E0B", bg: "rgba(245,158,11,0.15)" },
  { key: "b2e", label: "B2E", sub: "Business to eCommerce", icon: Globe,       color: "#14B8A6", bg: "rgba(20,184,166,0.15)" },
];

const DARK_BG = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const CARD = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };

export default function OutboundPage() {
  const router = useRouter();
  return (
    <div className="min-h-screen flex flex-col" style={DARK_BG}>
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div>
          <p className="text-base font-bold text-white">Outbound</p>
          <p className="text-xs text-slate-400">Select outbound type</p>
        </div>
      </header>

      <main className="flex-1 p-5 space-y-5">
        {/* Cluster Pick */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Batch Picking</p>
          <button onClick={() => router.push("/outbound/cluster")}
            className="w-full rounded-2xl p-5 flex items-center gap-4 active:scale-[0.98] transition-all text-left"
            style={{ ...CARD, border: "1px solid rgba(34,197,94,0.25)", background: "rgba(34,197,94,0.08)" }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: "rgba(34,197,94,0.2)" }}>
              <PackageCheck className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <p className="text-base font-semibold text-white">Cluster Pick</p>
              <p className="text-sm text-slate-400 mt-0.5">Up to 25 orders · one-pass routing</p>
            </div>
            <span className="ml-auto text-slate-500 text-xl">›</span>
          </button>
        </div>

        {/* Single order picking */}
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">Single Order Picking</p>
          <div className="space-y-3">
            {TYPES.map(({ key, label, sub, icon: Icon, color, bg }) => (
              <button key={key} onClick={() => router.push(`/outbound/${key}`)}
                className="w-full rounded-2xl p-5 flex items-center gap-4 active:scale-[0.98] transition-all text-left"
                style={CARD}>
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: bg }}>
                  <Icon className="w-6 h-6" style={{ color }} />
                </div>
                <div>
                  <p className="text-base font-semibold text-white">{label} Picking</p>
                  <p className="text-sm text-slate-400 mt-0.5">{sub}</p>
                </div>
                <span className="ml-auto text-slate-500 text-xl">›</span>
              </button>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
