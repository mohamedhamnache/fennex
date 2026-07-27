"use client";

import type { ReactNode } from "react";
import { hasPermission } from "@/lib/rbac";
import { useAdminStore } from "@/store";

interface RoleGateProps {
  /** Permission string checked against the logged-in admin's flattened
   * `permissions` list (see `lib/rbac.ts`). */
  permission: string;
  children: ReactNode;
  /** Optional content shown instead of nothing when the gate is closed. */
  fallback?: ReactNode;
}

/** Renders `children` only if the current admin (from the Zustand store)
 * holds `permission`. Used to hide mutation controls / restricted sections
 * from the UI — the server is always the real enforcement point
 * (`require_admin`), this is presentation-layer only. */
export function RoleGate({ permission, children, fallback = null }: RoleGateProps) {
  const admin = useAdminStore((s) => s.admin);
  if (!hasPermission(admin, permission)) return <>{fallback}</>;
  return <>{children}</>;
}
