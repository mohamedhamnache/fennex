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
  /**
   * False until zustand's persist middleware has finished reading
   * localStorage. The auth guard must wait for this before deciding to
   * redirect, otherwise a page refresh bounces to /login while the persisted
   * token is still loading. Not persisted (see partialize).
   */
  hasHydrated: boolean;
  setAuth: (token: string, admin: AdminUser) => void;
  clear: () => void;
  toggleTheme: () => void;
  setHasHydrated: (v: boolean) => void;
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
      hasHydrated: false,
      setAuth: (token, admin) => set({ token, admin }),
      clear: () => set({ token: null, admin: null }),
      toggleTheme: () =>
        set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: "fennex-admin-auth",
      partialize: (state) => ({ token: state.token, theme: state.theme }),
      // Fires after localStorage is read (even when empty) — flip the flag so
      // the auth guard can safely evaluate the restored token.
      onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
    },
  ),
);

/** Read the current token outside of React (used by `lib/api.ts`). */
export function getAdminToken(): string | null {
  return useAdminStore.getState().token;
}
