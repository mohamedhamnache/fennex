import { getAdminToken } from "@/store";

/**
 * Mirrors `apps/web/lib/api.ts`'s shape (ApiError, get/post/patch/delete
 * helpers, non-2xx throws with the server error message). Differences,
 * scoped to the admin console:
 *  - base URL is `NEXT_PUBLIC_ADMIN_API_URL` (falls back to the same local
 *    default web uses) instead of `NEXT_PUBLIC_API_URL`;
 *  - the bearer token is read from the Zustand admin store instead of a
 *    bare localStorage key, since the store is the single source of truth
 *    for admin auth state;
 *  - no refresh-token flow — staff sessions are short-lived; a 401 simply
 *    surfaces as an `ApiError` for the caller (the (console) layout guard
 *    added in a later task redirects to /login on any auth failure);
 *  - adds `postForm` for the one endpoint the backend expects as OAuth2
 *    form-encoded data (`/admin/auth/login`, via FastAPI's
 *    OAuth2PasswordRequestForm) — every other call is JSON.
 *
 * NEVER call `fetch` directly outside this module.
 */
export const ADMIN_API_BASE =
  (process.env.NEXT_PUBLIC_ADMIN_API_URL ?? "http://localhost:8000") + "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${ADMIN_API_BASE}${path}`, { ...init, headers });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let detail: Record<string, unknown> | undefined;
    try {
      const body = await res.json();
      if (typeof body.detail === "object" && body.detail !== null) {
        detail = body.detail as Record<string, unknown>;
        msg = (detail.code as string) ?? msg;
      } else {
        msg = body.detail ?? body.message ?? msg;
      }
    } catch {
      // response wasn't JSON — fall back to the HTTP status message above
    }
    throw new ApiError(res.status, msg, detail);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

async function requestForm<T>(path: string, form: Record<string, string>): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  /** Form-url-encoded POST — only used by `/admin/auth/login` today. */
  postForm: <T>(path: string, form: Record<string, string>) => requestForm<T>(path, form),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
