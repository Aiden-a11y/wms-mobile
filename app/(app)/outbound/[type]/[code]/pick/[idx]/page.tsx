"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { loadPickList, savePickList, confirmPick, type PickTask } from "@/lib/picking";
import { authHeaders } from "@/lib/api";
import { ChevronLeft, MapPin, ScanLine, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

type Step = 1 | 2 | 3 | 4 | 5;

const DARK_BG = { background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)" };
const CARD = { background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" };
const HDR_BORDER = { borderBottom: "1px solid rgba(255,255,255,0.08)" };
const BLUE_BOX = { background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)" };
const GREEN_BOX = { background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)" };
const INPUT_STYLE = { background: "rgba(255,255,255,0.07)", border: "2px solid rgba(59,130,246,0.5)" };

export default function PickStepPage() {
  const router = useRouter();
  const { type, code, idx: idxStr } = useParams<{ type: string; code: string; idx: string }>();
  const idx = parseInt(idxStr, 10);

  const [task, setTask] = useState<PickTask | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [scanInput, setScanInput] = useState("");
  const [qtyInput, setQtyInput] = useState("");
  const [unit, setUnit] = useState<"EA" | "CARTON">("EA");
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tasks = loadPickList(code);
    const t = tasks?.find((t) => t.idx === idx) ?? null;
    setTask(t);
    if (t) setQtyInput(String(t.allocatedQty));
  }, [code, idx]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [step]);

  function normalizeLoc(raw: string): string {
    return raw.trim().toLowerCase().replace(/[\s\-_/]+/g, "");
  }

  async function handleStep1Scan() {
    if (!task) return;
    setError("");
    const scanned = scanInput.trim();
    if (!scanned) return;
    try {
      const res = await fetch(
        `/api/wms/warehouse/location-search?q=${encodeURIComponent(scanned)}&warehouseCode=STOO1`,
        { headers: authHeaders() }
      );
      const json = await res.json();
      const d = json?.data ?? json;
      const parts = [d?.zoneName, d?.aisleName, d?.bayName, d?.levelName, d?.positionName].filter(Boolean);
      const foundCode = parts.length > 0 ? parts.join("/") : scanned;
      if (
        normalizeLoc(foundCode) !== normalizeLoc(task.locationCode) &&
        normalizeLoc(scanned)   !== normalizeLoc(task.locationCode)
      ) {
        setError(`로케이션 불일치\n예상: ${task.locationCode}`);
        setScanInput(""); return;
      }
    } catch {
      if (normalizeLoc(scanned) !== normalizeLoc(task.locationCode)) {
        setError(`로케이션 불일치\n예상: ${task.locationCode}`);
        setScanInput(""); return;
      }
    }
    setScanInput(""); setStep(2);
  }

  function handleStep2Scan() {
    if (!task) return;
    setError("");
    const scanned = scanInput.trim();
    if (!scanned) return;
    if (scanned.toLowerCase() === task.sku.toLowerCase()) {
      setScanInput(""); setStep(3); return;
    }
    setError(`상품 불일치\n예상 SKU: ${task.sku}`);
    setScanInput("");
  }

  function handleStep3Confirm() {
    const q = parseInt(qtyInput, 10);
    if (isNaN(q) || q <= 0) { setError("수량을 입력하세요"); return; }
    setError(""); setStep(4);
  }

  function handleStep4Select(u: "EA" | "CARTON") {
    setUnit(u); setStep(5);
  }

  async function handleComplete() {
    if (!task) return;
    setConfirming(true);
    setError("");

    const pickedQty = parseInt(qtyInput, 10);

    // 1. WMS API 피킹 확정 호출
    const result = await confirmPick(code, type, task, pickedQty, unit);
    if (!result.ok) {
      setError(`피킹 확정 실패: ${result.message ?? "알 수 없는 오류"}`);
      setConfirming(false);
      return;
    }

    // 2. 로컬 상태 업데이트
    const tasks = loadPickList(code) ?? [];
    const updated = tasks.map((t) =>
      t.idx === idx ? { ...t, pickedQty, unit, status: "done" as const } : t
    );
    savePickList(code, updated);

    // 3. 다음 태스크로 이동
    const next = updated.find((t) => t.status === "pending");
    if (next) {
      router.replace(`/outbound/${type}/${code}/pick/${next.idx}`);
    } else {
      router.replace(`/outbound/${type}/${code}/complete`);
    }
  }

  const STEPS = ["로케이션", "상품 스캔", "수량 확인", "단위 선택", "완료"];

  if (!task) return (
    <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm" style={DARK_BG}>
      태스크를 찾을 수 없습니다
    </div>
  );

  // Location display: split by / or - for visual formatting
  const locParts = task.locationCode.split(/[\/\-]/).filter(Boolean);

  return (
    <div className="min-h-screen flex flex-col" style={DARK_BG}>
      {/* Confirming overlay */}
      {confirming && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3"
          style={{ background: "rgba(8,13,26,0.92)", backdropFilter: "blur(8px)" }}>
          <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
          <p className="text-white font-semibold">피킹 확정 중…</p>
        </div>
      )}

      {/* Header */}
      <header className="px-5 py-4 flex items-center gap-3 flex-shrink-0" style={HDR_BORDER}>
        <button onClick={() => router.back()} className="p-1 text-slate-400 active:text-white transition-colors">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold text-white">피킹 {idx + 1}</p>
          <p className="text-xs text-slate-400 font-mono">{task.sku}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500 font-mono">{code}</p>
        </div>
      </header>

      {/* Step indicator */}
      <div className="px-5 py-3 flex items-center gap-1.5" style={HDR_BORDER}>
        {STEPS.map((label, i) => {
          const s = (i + 1) as Step;
          const active = step === s;
          const isDone = step > s;
          return (
            <div key={i} className="flex items-center gap-1">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={
                  isDone  ? { background: "rgba(34,197,94,0.25)",  color: "#4ade80", border: "1px solid rgba(34,197,94,0.4)" }
                  : active ? { background: "rgba(59,130,246,0.3)",  color: "#93c5fd", border: "1px solid rgba(59,130,246,0.5)" }
                  :          { background: "rgba(255,255,255,0.06)", color: "#64748b", border: "1px solid rgba(255,255,255,0.08)" }
                }>
                {isDone ? "✓" : s}
              </div>
              {i < STEPS.length - 1 && (
                <div className="h-px w-3 flex-shrink-0"
                  style={{ background: isDone ? "rgba(74,222,128,0.4)" : "rgba(255,255,255,0.1)" }} />
              )}
            </div>
          );
        })}
      </div>

      <main className="flex-1 flex flex-col p-5 gap-5">
        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm text-red-300 whitespace-pre-line"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)" }}>
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />{error}
          </div>
        )}

        {/* Step 1: Location scan */}
        {step === 1 && (
          <div className="flex flex-col gap-5 flex-1">
            <div className="rounded-2xl p-5 text-center" style={CARD}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">목표 로케이션</p>
              <div className="flex items-center justify-center gap-2 mb-2">
                <MapPin className="w-5 h-5 text-blue-400" />
                <p className="text-2xl font-bold font-mono text-white tracking-wider">
                  {locParts.join(" / ")}
                </p>
              </div>
              {task.lotNo && (
                <p className="text-xs text-slate-400 mt-1">LOT <strong className="text-slate-300">{task.lotNo}</strong></p>
              )}
              {task.expireDate && (
                <p className="text-xs text-slate-400">EXP <strong className="text-slate-300">{task.expireDate.slice(0,4)}-{task.expireDate.slice(4,6)}-{task.expireDate.slice(6,8)}</strong></p>
              )}
            </div>
            <div className="rounded-2xl p-4 text-center" style={BLUE_BOX}>
              <ScanLine className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-blue-300">로케이션 바코드를 스캔하세요</p>
            </div>
            <input ref={inputRef} type="text" value={scanInput}
              onChange={(e) => { setScanInput(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleStep1Scan()}
              placeholder="스캔 또는 입력 후 Enter"
              className="w-full h-14 rounded-2xl px-4 text-center text-base text-white placeholder-slate-500 focus:outline-none"
              style={INPUT_STYLE}
            />
          </div>
        )}

        {/* Step 2: Product scan */}
        {step === 2 && (
          <div className="flex flex-col gap-5 flex-1">
            <div className="rounded-2xl p-5" style={CARD}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-3">상품 정보</p>
              <p className="text-base font-semibold text-white mb-1">{task.productName}</p>
              <p className="text-sm font-mono text-slate-400">SKU: {task.sku}</p>
              {task.itemCondition && task.itemCondition !== "GOOD" && (
                <p className="text-xs text-amber-400 mt-1">상태: {task.itemCondition}</p>
              )}
            </div>
            <div className="rounded-2xl p-4 text-center" style={BLUE_BOX}>
              <ScanLine className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-blue-300">상품 바코드를 스캔하세요</p>
            </div>
            <input ref={inputRef} type="text" value={scanInput}
              onChange={(e) => { setScanInput(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleStep2Scan()}
              placeholder="바코드 스캔 또는 입력 후 Enter"
              className="w-full h-14 rounded-2xl px-4 text-center text-base text-white placeholder-slate-500 focus:outline-none"
              style={INPUT_STYLE}
            />
          </div>
        )}

        {/* Step 3: Qty */}
        {step === 3 && (
          <div className="flex flex-col gap-5 flex-1">
            <div className="rounded-2xl p-5 text-center" style={CARD}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">할당 수량</p>
              <p className="text-5xl font-bold text-white">{task.allocatedQty}</p>
              <p className="text-sm text-slate-400 mt-1">실제 수량을 확인 후 입력하세요</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wide block mb-2">실제 피킹 수량</label>
              <input ref={inputRef} type="number" value={qtyInput}
                onChange={(e) => { setQtyInput(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleStep3Confirm()}
                min={1}
                className="w-full h-14 rounded-2xl px-4 text-center text-xl font-bold text-white focus:outline-none"
                style={{ background: "rgba(255,255,255,0.07)", border: "2px solid rgba(255,255,255,0.15)" }}
              />
            </div>
            <button onClick={handleStep3Confirm}
              className="w-full h-14 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-2xl text-base transition-colors">
              확인
            </button>
          </div>
        )}

        {/* Step 4: Unit */}
        {step === 4 && (
          <div className="flex flex-col gap-5 flex-1">
            <div className="rounded-2xl p-5 text-center" style={CARD}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">피킹 단위 선택</p>
              <p className="text-sm text-slate-300">수량: <strong className="text-white">{qtyInput}</strong></p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(["EA", "CARTON"] as const).map((u) => (
                <button key={u} onClick={() => handleStep4Select(u)}
                  className="h-24 rounded-2xl flex flex-col items-center justify-center gap-1 active:scale-95 transition-all"
                  style={CARD}>
                  <p className="text-2xl font-bold text-white">{u}</p>
                  <p className="text-xs text-slate-400">{u === "EA" ? "낱개" : "박스/카톤"}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 5: Confirm & Complete */}
        {step === 5 && (
          <div className="flex flex-col gap-5 flex-1">
            <div className="rounded-2xl p-5" style={GREEN_BOX}>
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle2 className="w-8 h-8 text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-base font-semibold text-green-300">피킹 준비 완료</p>
                  <p className="text-xs text-slate-400">아래 내용을 확인하고 확정하세요</p>
                </div>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-400">로케이션</span>
                  <span className="font-mono font-semibold text-white">{locParts.join(" / ")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">SKU</span>
                  <span className="font-mono text-white">{task.sku}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">수량</span>
                  <span className="font-semibold text-white">{qtyInput} {unit}</span>
                </div>
                {task.lotNo && (
                  <div className="flex justify-between">
                    <span className="text-slate-400">LOT</span>
                    <span className="text-white">{task.lotNo}</span>
                  </div>
                )}
              </div>
            </div>
            <button onClick={handleComplete} disabled={confirming}
              className="w-full h-14 bg-green-600 hover:bg-green-500 disabled:opacity-50 text-white font-semibold rounded-2xl text-base transition-colors flex items-center justify-center gap-2">
              {confirming ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
              피킹 확정
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
