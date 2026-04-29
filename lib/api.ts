import { getAuth } from "./auth";

export function authHeaders(): Record<string, string> {
  const user = getAuth();
  return {
    Authorization: `Bearer ${user?.token ?? ""}`,
    "Content-Type": "application/json",
  };
}

export async function wmsGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`/api/wms/${path}`, { headers: authHeaders() });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message ?? "API error");
  return (json?.data ?? json) as T;
}

export async function wmsPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/wms/${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.message ?? "API error");
  return (json?.data ?? json) as T;
}
