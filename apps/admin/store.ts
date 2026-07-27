import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Staff account returned by GET /admin/me. */
export interface AdminUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  permissions: string[];
}

export type AdminTheme = "light" | "dark";

interface AdminState {
  token: string | null;
  admin: AdminUser | null;
  theme: AdminTheme;
  setAuth: (token: string, admin: AdminUser) => void;
  clear: () => void;
  toggleTheme: () => void;
}

/**
 * Auth + theme store for the admin console.
 *
 * Only `token` and `theme` are persisted to localStorage (via zustand's
 * `persist` middleware) — `admin` (roles/permissions) is re-fetched from
 * `/admin/me` on load so RBAC data never goes stale in storage. zustand's
 * default JSON storage lazily resolves `localStorage` and swallows the
 * ReferenceError on the server, so no manual `typeof window` guard is
 * needed here; `getAdminToken()` below is safe to call during SSR too.
 */
export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      token: null,
      admin: null,
      theme: "dark",
      setAuth: (token, admin) => set({ token, admin }),
      clear: () => set({ token: null, admin: null }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
    }),
    {
      name: "fennex-admin-auth",
      partialize: (state) => ({ token: state.token, theme: state.theme }),
    },
  ),
);

/** Read the current token outside of React (used by `lib/api.ts`). */
export function getAdminToken(): string | null {
  return useAdminStore.getState().token;
}
