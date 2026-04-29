"use client";
import { useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { clearPickList } from "@/lib/picking";
import { CheckCircle2, ScanLine, Home } from "lucide-react";

export default function CompletePage() {
  const router = useRouter();
  const { type, code } = useParams<{ type: string; code: string }>();
  const [scanInput, setScanInput] = useState("");
  const [done, setDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleScan() {
    const v = scanInput.trim();
    if (!v) return;
    // TODO: call packing zone API when endpoint is confirmed
    clearPickList(code);
    setDone(true);
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 gap-6">
        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle2 className="w-10 h-10 text-green-600" />
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-slate-900 mb-1">피킹 완료!</p>
          <p className="text-sm text-slate-500 font-mono">{code}</p>
        </div>
        <button onClick={() => router.replace("/home")}
          className="flex items-center gap-2 h-14 px-8 bg-blue-600 text-white font-semibold rounded-2xl text-base">
          <Home className="w-5 h-5" /> 홈으로
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-5 py-4">
        <p className="text-base font-bold text-slate-900">피킹 완료</p>
        <p className="text-xs text-slate-500 font-mono">{code}</p>
      </header>
      <main className="flex-1 flex flex-col items-center justify-center p-6 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 w-full shadow-sm text-center">
          <ScanLine className="w-10 h-10 text-blue-400 mx-auto mb-3" />
          <p className="text-lg font-semibold text-slate-900 mb-1">패킹존 바코드 스캔</p>
          <p className="text-sm text-slate-400">스캔하면 피킹이 완료됩니다</p>
        </div>
        <input
          ref={inputRef}
          autoFocus
          type="text"
          value={scanInput}
          onChange={(e) => setScanInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleScan()}
          placeholder="패킹존 스캔 또는 입력 후 Enter"
          className="w-full h-14 border-2 border-blue-300 rounded-2xl px-4 text-center text-base focus:outline-none focus:border-blue-500 bg-white"
        />
        <button onClick={handleScan}
          className="w-full h-14 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-2xl text-base transition-colors">
          완료 확인
        </button>
      </main>
    </div>
  );
}
