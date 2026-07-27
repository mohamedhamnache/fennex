"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingSkeleton } from "@fennex/ui";
import { apiClient } from "@/lib/api";
import { useAdminStore, type AdminUser } from "@/store";
import { AdminShell } from "@/components/shell/AdminShell";

/**
 * Auth guard for every `(console)` route: no token -> bounce to `/login`;
 * token but no cached `admin` profile (fresh reload) -> fetch `GET /admin/me`
 * once and stash it in the store; either way, render the shell only once we
 * know who's signed in.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const token = useAdminStore((s) => s.token);
  const admin = useAdminStore((s) => s.admin);
  const setAuth = useAdminStore((s) => s.setAuth);
  const clear = useAdminStore((s) => s.clear);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) {
      router.replace("/login");
      return;
    }
    if (admin) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    apiClient
      .get<AdminUser>("/admin/me")
      .then((profile) => {
        if (cancelled) return;
        setAuth(token, profile);
        setChecking(false);
      })
      .catch(() => {
        if (cancelled) return;
        clear();
        router.replace("/login");
      });
    return () => {
      cancelled = true;
    };
  }, [token, admin, setAuth, clear, router]);

  if (!token || checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="card-base card-shadow w-full max-w-sm border border-border bg-card p-6">
          <LoadingSkeleton lines={4} />
        </div>
      </div>
    );
  }

  return <AdminShell>{children}</AdminShell>;
}
