"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { setAuth } from "@/lib/auth";

function WmsLogo({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      {/* warehouse body */}
      <rect x="6" y="24" width="44" height="26" rx="3" fill="white" fillOpacity="0.15"/>
      <rect x="6" y="24" width="44" height="26" rx="3" stroke="white" strokeWidth="2.2"/>
      {/* roof */}
      <path d="M3 26L28 8L53 26" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
      {/* door */}
      <rect x="20" y="36" width="16" height="14" rx="1.5" stroke="white" strokeWidth="2" strokeOpacity="0.9"/>
      {/* left window */}
      <rect x="10" y="30" width="7" height="5" rx="1" fill="white" fillOpacity="0.35"/>
      {/* right window */}
      <rect x="39" y="30" width="7" height="5" rx="1" fill="white" fillOpacity="0.35"/>
      {/* arrow up (picking motion) */}
      <path d="M28 44V34M28 34L24 38M28 34L32 38" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.8"/>
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/wms/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, password, clientId: "wms_web" }),
      });
      const json = await res.json();
      const d = json?.data ?? json;
      const token = d?.token ?? d?.accessToken ?? d?.access_token;
      if (!res.ok || !token) throw new Error(json?.message ?? "로그인 실패");
      setAuth({ userId, token, name: d?.name ?? d?.userName ?? userId });
      router.replace("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "아이디 또는 비밀번호가 올바르지 않습니다");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Top brand area */}
      <div className="bg-slate-900 flex flex-col items-center justify-center pt-16 pb-12 px-6 flex-shrink-0">
        <WmsLogo className="w-16 h-16 mb-5" />
        <h1 className="text-2xl font-bold text-white tracking-tight">STOO WMS</h1>
        <p className="text-slate-400 text-sm mt-1.5">Mobile Warehouse System</p>

        {/* decorative dots */}
        <div className="flex gap-1.5 mt-8 opacity-30">
          {[...Array(5)].map((_, i) => (
            <div key={i} className={`rounded-full bg-white ${i === 2 ? "w-2 h-2" : "w-1.5 h-1.5 mt-0.5"}`} />
          ))}
        </div>
      </div>

      {/* Form area */}
      <div className="flex-1 bg-slate-50 rounded-t-3xl -mt-4 px-6 pt-8 pb-10 flex flex-col">
        <h2 className="text-xl font-bold text-slate-900 mb-1">로그인</h2>
        <p className="text-sm text-slate-400 mb-7">계정 정보를 입력하세요</p>

        {error && (
          <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-700 flex items-center gap-2">
            <span className="text-red-400">⚠</span> {error}
          </div>
        )}

        <form onSubmit={login} className="flex flex-col gap-4 flex-1">
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest block mb-2">
              User ID
            </label>
            <input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              required
              placeholder="사용자 ID 입력"
              className="w-full h-13 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent shadow-sm placeholder:text-slate-300"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-widest block mb-2">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              placeholder="비밀번호 입력"
              className="w-full h-13 border border-slate-200 rounded-2xl px-4 py-3.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent shadow-sm placeholder:text-slate-300"
            />
          </div>

          <div className="mt-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold rounded-2xl transition-colors text-base tracking-wide shadow-sm"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  로그인 중…
                </span>
              ) : "로그인"}
            </button>
          </div>
        </form>

        <p className="text-center text-xs text-slate-300 mt-8">
          STOO WMS Mobile v1.0
        </p>
      </div>
    </div>
  );
}
