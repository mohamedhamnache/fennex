const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("fennex_access_token");
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/v1${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.detail ?? body.message ?? msg;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export async function authLogin(email: string, password: string): Promise<TokenResponse> {
  const data = await apiClient.post<TokenResponse>("/auth/login", { email, password });
  localStorage.setItem("fennex_access_token", data.access_token);
  localStorage.setItem("fennex_refresh_token", data.refresh_token);
  return data;
}

export async function authRegister(
  email: string,
  password: string,
  fullName: string,
  orgName: string
): Promise<TokenResponse> {
  const data = await apiClient.post<TokenResponse>("/auth/register", {
    email,
    password,
    full_name: fullName,
    org_name: orgName,
  });
  localStorage.setItem("fennex_access_token", data.access_token);
  localStorage.setItem("fennex_refresh_token", data.refresh_token);
  return data;
}

export function authLogout() {
  localStorage.removeItem("fennex_access_token");
  localStorage.removeItem("fennex_refresh_token");
}

export function isAuthenticated(): boolean {
  if (typeof window === "undefined") return false;
  return !!localStorage.getItem("fennex_access_token");
}
