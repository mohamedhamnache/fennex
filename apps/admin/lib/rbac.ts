import type { AdminUser } from "@/store";

/** True if the admin (or their roles) grant `perm`. `admin.permissions` is
 * the flattened list the backend already resolves from roles, so this is a
 * plain membership check. */
export function hasPermission(admin: AdminUser | null | undefined, perm: string): boolean {
  if (!admin) return false;
  return admin.permissions.includes(perm);
}
