"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { loadPickList, savePickList, type PickTask } from "@/lib/picking";
import { authHeaders } from "@/lib/api";
import { ChevronLeft, MapPin, ScanLine, CheckCircle2, AlertCircle } from "lucide-react";

type Step = 1 | 2 | 3 | 4 | 5;

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
  const [stepDone, setStepDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tasks = loadPickList(code);
    const t = tasks?.find((t) => t.idx === idx) ?? null;
    setTask(t);
    if (t) setQtyInput(String(t.allocatedQty));
  }, [code, idx]);

  useEffect(() => {
    if (!stepDone) setTimeout(() => inputRef.current?.focus(), 100);
  }, [step, stepDone]);

  function normalizeLoc(raw: string): string {
    return raw.trim().toLowerCase().replace(/\s+/g, "");
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
      const foundCode = parts.length > 0 ? parts.join("-") : scanned;
      if (normalizeLoc(foundCode) !== normalizeLoc(task.locationCode) &&
          normalizeLoc(scanned)   !== normalizeLoc(task.locationCode)) {
        setError(`로케이션 불일치: 예상 ${task.locationCode}`);
        setScanInput(""); return;
      }
    } catch {
      // API 실패 시 직접 비교
      if (normalizeLoc(scanned) !== normalizeLoc(task.locationCode)) {
        setError(`로케이션 불일치: 예상 ${task.locationCode}`);
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
    // match against SKU directly
    if (scanned.toLowerCase() === task.sku.toLowerCase()) {
      setScanInput(""); setStep(3); return;
    }
    setError(`상품 불일치: 예상 SKU ${task.sku}`);
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

  function handleComplete() {
    if (!task) return;
    const tasks = loadPickList(code) ?? [];
    const updated = tasks.map((t) =>
      t.idx === idx ? { ...t, pickedQty: parseInt(qtyInput, 10), unit, status: "done" as const } : t
    );
    savePickList(code, updated);

    const next = updated.find((t) => t.status === "pending");
    if (next) {
      router.replace(`/outbound/${type}/${code}/pick/${next.idx}`);
    } else {
      router.replace(`/outbound/${type}/${code}/complete`);
    }
  }

  const STEPS = ["로케이션", "상품 스캔", "수량 확인", "단위 선택", "완료"];

  if (!task) return (
    <div className="min-h-screen flex items-center justify-center text-slate-400 text-sm">
      태스크를 찾을 수 없습니다
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-5 py-4 flex items-center gap-3 flex-shrink-0">
        <button onClick={() => router.back()} className="p-1 text-slate-400 hover:text-slate-700">
          <ChevronLeft className="w-6 h-6" />
        </button>
        <div className="flex-1">
          <p className="text-sm font-bold text-slate-900">피킹 {idx + 1}</p>
          <p className="text-xs text-slate-500 font-mono">{task.sku}</p>
        </div>
      </header>

      {/* Step indicator */}
      <div className="bg-white border-b border-slate-200 px-5 py-3 flex items-center gap-2">
        {STEPS.map((label, i) => {
          const s = (i + 1) as Step;
          const active = step === s;
          const done = step > s;
          return (
            <div key={i} className="flex items-center gap-1.5">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                done ? "bg-green-500 text-white" : active ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-400"
              }`}>{done ? "✓" : s}</div>
              {i < STEPS.length - 1 && <div className={`flex-1 h-0.5 w-4 ${done ? "bg-green-400" : "bg-slate-200"}`} />}
            </div>
          );
        })}
      </div>

      <main className="flex-1 flex flex-col p-5 gap-5">
        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
          </div>
        )}

        {/* Step 1: Location scan */}
        {step === 1 && (
          <div className="flex flex-col gap-5 flex-1">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 text-center shadow-sm">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">목표 로케이션</p>
              <div className="flex items-center justify-center gap-2 mb-1">
                <MapPin className="w-5 h-5 text-blue-500" />
                <p className="text-3xl font-bold font-mono text-slate-900">{task.locationCode}</p>
              </div>
              <p className="text-sm text-slate-500">
                Aisle <strong>{task.aisle}</strong> · Bay <strong>{task.bay}</strong> · Level <strong>{task.level}</strong>
              </p>
            </div>
            <div className="bg-blue-50 rounded-2xl border border-blue-200 p-4 text-center">
              <ScanLine className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-blue-700">로케이션 바코드를 스캔하세요</p>
            </div>
            <input ref={inputRef} type="text" value={scanInput}
              onChange={(e) => { setScanInput(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleStep1Scan()}
              placeholder="스캔 또는 입력 후 Enter"
              className="w-full h-14 border-2 border-blue-300 rounded-2xl px-4 text-center text-base focus:outline-none focus:border-blue-500 bg-white"
            />
          </div>
        )}

        {/* Step 2: Product scan */}
        {step === 2 && (
          <div className="flex flex-col gap-5 flex-1">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">상품 정보</p>
              <p className="text-base font-semibold text-slate-900 mb-1">{task.productName}</p>
              <p className="text-sm font-mono text-slate-500">SKU: {task.sku}</p>
            </div>
            <div className="bg-blue-50 rounded-2xl border border-blue-200 p-4 text-center">
              <ScanLine className="w-8 h-8 text-blue-400 mx-auto mb-2" />
              <p className="text-sm font-semibold text-blue-700">상품 바코드를 스캔하세요</p>
            </div>
            <input ref={inputRef} type="text" value={scanInput}
              onChange={(e) => { setScanInput(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleStep2Scan()}
              placeholder="바코드 스캔 또는 입력 후 Enter"
              className="w-full h-14 border-2 border-blue-300 rounded-2xl px-4 text-center text-base focus:outline-none focus:border-blue-500 bg-white"
            />
          </div>
        )}

        {/* Step 3: Qty */}
        {step === 3 && (
          <div className="flex flex-col gap-5 flex-1">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm text-center">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">할당 수량</p>
              <p className="text-5xl font-bold text-slate-900">{task.allocatedQty}</p>
              <p className="text-sm text-slate-400 mt-1">실제 수량을 확인 후 입력하세요</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-2">실제 피킹 수량</label>
              <input ref={inputRef} type="number" value={qtyInput}
                onChange={(e) => { setQtyInput(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleStep3Confirm()}
                min={1}
                className="w-full h-14 border-2 border-slate-200 rounded-2xl px-4 text-center text-xl font-bold focus:outline-none focus:border-blue-500 bg-white"
              />
            </div>
            <button onClick={handleStep3Confirm}
              className="w-full h-14 bg-blue-600 text-white font-semibold rounded-2xl text-base">
              확인
            </button>
          </div>
        )}

        {/* Step 4: Unit */}
        {step === 4 && (
          <div className="flex flex-col gap-5 flex-1">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm text-center">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-2">피킹 단위 선택</p>
              <p className="text-sm text-slate-600">수량: <strong>{qtyInput}</strong></p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {(["EA", "CARTON"] as const).map((u) => (
                <button key={u} onClick={() => handleStep4Select(u)}
                  className="h-24 bg-white border-2 border-slate-200 rounded-2xl flex flex-col items-center justify-center gap-1 hover:border-blue-400 hover:bg-blue-50 active:scale-95 transition-all">
                  <p className="text-2xl font-bold text-slate-900">{u}</p>
                  <p className="text-xs text-slate-400">{u === "EA" ? "낱개" : "박스/카톤"}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 5: Cart scan (placeholder) */}
        {step === 5 && (
          <div className="flex flex-col gap-5 flex-1">
            <div className="bg-green-50 rounded-2xl border border-green-200 p-5 shadow-sm text-center">
              <CheckCircle2 className="w-10 h-10 text-green-500 mx-auto mb-2" />
              <p className="text-base font-semibold text-green-800">피킹 준비 완료</p>
              <div className="mt-3 text-sm text-slate-600 space-y-1">
                <p>로케이션: <strong className="font-mono">{task.locationCode}</strong></p>
                <p>수량: <strong>{qtyInput} {unit}</strong></p>
              </div>
            </div>
            <div className="bg-slate-100 rounded-2xl p-4 text-center text-slate-500 text-sm">
              <p className="font-semibold mb-1">피킹 카트 스캔</p>
              <p className="text-xs">추후 구현 예정</p>
            </div>
            <button onClick={handleComplete}
              className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-2xl text-base transition-colors">
              다음 로케이션 →
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
