"use client";
import { useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { clearPickList } from "@/lib/picking";
import { CheckCircle2, ScanLine, Home } from "lucide-react";

const DARK_BG = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const CARD = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };
const GREEN_BOX = { background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)" };
const INPUT_STYLE = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(59,130,246,0.5)" };

export default function CompletePage() {
  const router = useRouter();
  const { code } = useParams<{ type: string; code: string }>();
  const [scanInput, setScanInput] = useState("");
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleScan() {
    const v = scanInput.trim();
    if (!v) return;
    clearPickList(code);
    setDone(true);
  }

  if (done) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-6" style={DARK_BG}>
        <div className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)" }}>
          <CheckCircle2 className="w-10 h-10 text-green-400" />
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-white mb-1">Picking Complete!</p>
          <p className="text-sm text-slate-400 font-mono">{code}</p>
        </div>
        <button onClick={() => router.replace("/home")}
          className="flex items-center gap-2 h-14 px-8 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-2xl text-base transition-colors">
          <Home className="w-5 h-5" /> Home
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={DARK_BG}>
      <header className="px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <p className="text-base font-bold text-white">Picking Complete</p>
        <p className="text-xs text-slate-400 font-mono">{code}</p>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <div className="rounded-2xl p-6 w-full text-center" style={CARD}>
          <ScanLine className="w-10 h-10 text-blue-400 mx-auto mb-3" />
          <p className="text-lg font-semibold text-white mb-1">Scan Packing Zone</p>
          <p className="text-sm text-slate-400">Scan to complete picking</p>
        </div>
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleScan()}
          placeholder="Scan packing zone or type + Enter"
          className="w-full h-14 rounded-2xl px-4 text-center text-base text-white placeholder-slate-500 focus:outline-none"
          style={INPUT_STYLE}
        />
        <button onClick={handleScan}
          className="w-full h-14 bg-green-600 hover:bg-green-500 text-white font-semibold rounded-2xl text-base transition-colors">
          Confirm
        </button>
      </main>
    </div>
  );
}
