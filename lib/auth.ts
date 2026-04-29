export interface AuthUser {
  userId: string;
  token: string;
  name?: string;
}

const KEY = "wms_auth";

export function getAuth(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export function setAuth(user: AuthUser) {
  sessionStorage.setItem(KEY, JSON.stringify(user));
}

export function clearAuth() {
  sessionStorage.removeItem(KEY);
}
