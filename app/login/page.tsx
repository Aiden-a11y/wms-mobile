"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { setAuth } from "@/lib/auth";

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
      if (!res.ok || !token) throw new Error(json?.message ?? "Invalid username or password");
      setAuth({ userId, token, name: d?.name ?? d?.userName ?? userId });
      router.replace("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-6 py-10"
      style={{
        background: "radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%)",
        backgroundImage: `
          radial-gradient(ellipse at 50% 0%, #1e2d4a 0%, #080d1a 60%),
          url("data:image/svg+xml,%3Csvg width='40' height='40' viewBox='0 0 40 40' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Ccircle cx='20' cy='20' r='1'/%3E%3C/g%3E%3C/svg%3E")
        `,
      }}
    >
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center mb-3">
          <Image src="/stl-logo.png" alt="STL Logo" width={120} height={48} className="object-contain" />
        </div>
        <p className="text-slate-400 text-sm tracking-wide">Spider WMS · Operations Dashboard</p>
      </div>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl p-7"
        style={{ background: "rgba(255,255,255,0.06)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)" }}>
        <h2 className="text-xl font-bold text-white mb-1">Sign in</h2>
        <p className="text-slate-400 text-sm mb-6">Enter your credentials to continue</p>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-sm text-red-300 flex items-center gap-2"
            style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)" }}>
            {error}
          </div>
        )}

        <form onSubmit={login} className="space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">User ID</label>
            <input
              type="text" value={userId} onChange={(e) => setUserId(e.target.value)}
              autoComplete="username" autoCapitalize="none" autoCorrect="off" required
              placeholder="Enter your user ID"
              className="w-full h-12 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Password</label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password" required
              placeholder="••••••••"
              className="w-full h-12 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)" }}
            />
          </div>
          <button type="submit" disabled={loading}
            className="w-full h-12 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl transition-colors text-sm tracking-wide mt-2">
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
                Signing in…
              </span>
            ) : "Sign In"}
          </button>
        </form>
      </div>

      <p className="text-slate-600 text-xs mt-8">STOO Logistics · WMS Mobile v1.0</p>
    </div>
  );
}
