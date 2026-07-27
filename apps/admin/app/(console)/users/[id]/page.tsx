"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  FolderKanban,
  Lock,
  LockOpen,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { RoleGate } from "@/components/common/RoleGate";
import type { AdminUserDetail } from "@/lib/admin-types";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  seo_manager: "SEO manager",
  content_writer: "Content writer",
  editor: "Editor",
  designer: "Designer",
  marketing_manager: "Marketing manager",
  viewer: "Viewer",
};

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" }).format(d);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message || fallback;
  return fallback;
}

/** One row of the Actions panel: an icon, a label/description, and a
 * RoleGate-wrapped trigger button. Mirrors the org detail page's ActionRow —
 * kept as a small local component since every action follows the same shape
 * (only the button contents differ). */
function ActionRow({
  icon: Icon,
  label,
  description,
  children,
}: {
  icon: typeof Ban;
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

const actionButtonClass =
  "inline-flex h-9 min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50";

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const queryClient = useQueryClient();
  const queryKey = ["admin", "user", userId];

  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivateReason, setDeactivateReason] = useState("");
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [lockReason, setLockReason] = useState("");
  const [unlockOpen, setUnlockOpen] = useState(false);

  const userQuery = useQuery({
    queryKey,
    queryFn: () => apiClient.get<AdminUserDetail>(`/admin/users/${userId}`),
    enabled: !!userId,
  });

  const user = userQuery.data;

  const invalidateUser = () => {
    // Refresh this user's detail and any users list so status changes made here
    // are reflected on the list page too.
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
  };

  const deactivateMutation = useMutation({
    mutationFn: (reason: string) =>
      apiClient.post(`/admin/users/${userId}/deactivate`, { reason: reason || undefined }),
    onSuccess: () => {
      invalidateUser();
      setDeactivateOpen(false);
      setDeactivateReason("");
    },
  });

  const reactivateMutation = useMutation({
    mutationFn: () => apiClient.post(`/admin/users/${userId}/reactivate`, {}),
    onSuccess: () => {
      invalidateUser();
      setReactivateOpen(false);
    },
  });

  const lockMutation = useMutation({
    mutationFn: (reason: string) => apiClient.post(`/admin/users/${userId}/lock`, { reason: reason || undefined }),
    onSuccess: () => {
      invalidateUser();
      setLockOpen(false);
      setLockReason("");
    },
  });

  const unlockMutation = useMutation({
    mutationFn: () => apiClient.post(`/admin/users/${userId}/unlock`, {}),
    onSuccess: () => {
      invalidateUser();
      setUnlockOpen(false);
    },
  });

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-6 p-6">
      <Link
        href="/users"
        className="inline-flex w-fit items-center gap-1.5 rounded text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to users
      </Link>

      {userQuery.isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load this user. Check the API connection and try again.
        </div>
      )}

      {userQuery.isLoading && (
        <div className="flex flex-col gap-6">
          <div className="skeleton h-9 w-64" />
          <div className="skeleton h-28 w-full" />
          <div className="skeleton h-40 w-full" />
        </div>
      )}

      {!userQuery.isLoading && !userQuery.isError && !user && (
        <div className="card-base flex flex-col items-center justify-center gap-2 border border-border bg-card p-8 text-center text-muted-foreground">
          <span className="text-sm">User not found.</span>
        </div>
      )}

      {user && (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-semibold text-foreground">
                  {user.full_name || "—"}
                </h1>
                <span className="badge bg-secondary text-secondary-foreground">{roleLabel(user.role)}</span>
                {user.is_active ? (
                  <span className="badge bg-muted text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    Active
                  </span>
                ) : (
                  <span className="badge bg-destructive/10 text-destructive">
                    <Ban className="h-3 w-3" aria-hidden="true" />
                    Inactive
                  </span>
                )}
                {user.locked && (
                  <span className="badge bg-destructive/10 text-destructive">
                    <Lock className="h-3 w-3" aria-hidden="true" />
                    Locked
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{user.email}</p>
              {user.locked && user.locked_reason && (
                <p className="mt-1 text-xs text-destructive">Lock reason: {user.locked_reason}</p>
              )}
            </div>
          </header>

          <dl className="card-base card-shadow grid grid-cols-2 gap-x-4 gap-y-3 border border-border bg-card p-4 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Organization</dt>
              <dd className="mt-0.5 text-foreground">
                <Link
                  href={`/orgs/${user.org.id}`}
                  className="rounded font-medium text-foreground transition-colors duration-150 hover:text-primary hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {user.org.name}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="mt-0.5 font-mono capitalize tabular-nums text-foreground">{user.org.plan_tier}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Language</dt>
              <dd className="mt-0.5 font-mono tabular-nums text-foreground">{user.language || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">User ID</dt>
              <dd className="mt-0.5 truncate font-mono tabular-nums text-foreground" title={user.id}>
                {user.id}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="mt-0.5 font-mono tabular-nums text-foreground">{formatDate(user.created_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Updated</dt>
              <dd className="mt-0.5 font-mono tabular-nums text-foreground">{formatDate(user.updated_at)}</dd>
            </div>
          </dl>

          <div className="card-base card-shadow flex flex-col divide-y divide-border border border-border bg-card p-4">
            <h2 className="pb-1 font-display text-sm font-semibold text-foreground">Actions</h2>

            <RoleGate permission="user.manage">
              <>
                {user.is_active ? (
                  <ActionRow
                    icon={Ban}
                    label="Deactivate user"
                    description="Immediately blocks this user from signing in."
                  >
                    <button
                      type="button"
                      onClick={() => setDeactivateOpen(true)}
                      className={cn(actionButtonClass, "border-destructive/40 text-destructive hover:bg-destructive/10")}
                    >
                      <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                      Deactivate
                    </button>
                  </ActionRow>
                ) : (
                  <ActionRow
                    icon={CheckCircle2}
                    label="Reactivate user"
                    description="Restores this user's ability to sign in."
                  >
                    <button
                      type="button"
                      onClick={() => setReactivateOpen(true)}
                      className={cn(actionButtonClass, "border-border text-foreground hover:bg-accent")}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Reactivate
                    </button>
                  </ActionRow>
                )}

                {!user.locked ? (
                  <ActionRow
                    icon={Lock}
                    label="Lock account"
                    description="Locks this account, forcing a credential/security review before sign-in."
                  >
                    <button
                      type="button"
                      onClick={() => setLockOpen(true)}
                      className={cn(actionButtonClass, "border-destructive/40 text-destructive hover:bg-destructive/10")}
                    >
                      <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                      Lock
                    </button>
                  </ActionRow>
                ) : (
                  <ActionRow
                    icon={LockOpen}
                    label="Unlock account"
                    description="Lifts the lock and allows this user to sign in again."
                  >
                    <button
                      type="button"
                      onClick={() => setUnlockOpen(true)}
                      className={cn(actionButtonClass, "border-border text-foreground hover:bg-accent")}
                    >
                      <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      Unlock
                    </button>
                  </ActionRow>
                )}
              </>
            </RoleGate>
          </div>
        </>
      )}

      <ConfirmDialog
        open={deactivateOpen}
        title="Deactivate user"
        description={user ? `This immediately blocks ${user.full_name || user.email} from signing in.` : undefined}
        confirmLabel="Deactivate"
        destructive
        loading={deactivateMutation.isPending}
        onConfirm={() => deactivateMutation.mutate(deactivateReason)}
        onClose={() => {
          if (deactivateMutation.isPending) return;
          setDeactivateOpen(false);
          setDeactivateReason("");
        }}
      >
        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor="deactivate-reason" className="text-xs font-medium text-muted-foreground">
            Reason (recorded in the audit log)
          </label>
          <textarea
            id="deactivate-reason"
            value={deactivateReason}
            onChange={(e) => setDeactivateReason(e.target.value)}
            rows={3}
            placeholder="e.g. offboarded, policy violation..."
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {deactivateMutation.isError && (
            <p className="text-xs text-destructive">{errorMessage(deactivateMutation.error, "Failed to deactivate user.")}</p>
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={reactivateOpen}
        title="Reactivate user"
        description={user ? `Restores ${user.full_name || user.email}'s ability to sign in.` : undefined}
        confirmLabel="Reactivate"
        loading={reactivateMutation.isPending}
        onConfirm={() => reactivateMutation.mutate()}
        onClose={() => {
          if (reactivateMutation.isPending) return;
          setReactivateOpen(false);
        }}
      >
        {reactivateMutation.isError && (
          <p className="mt-2 text-xs text-destructive">{errorMessage(reactivateMutation.error, "Failed to reactivate user.")}</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={lockOpen}
        title="Lock account"
        description={
          user ? `Locks ${user.full_name || user.email}'s account, blocking sign-in until unlocked.` : undefined
        }
        confirmLabel="Lock"
        destructive
        loading={lockMutation.isPending}
        onConfirm={() => lockMutation.mutate(lockReason)}
        onClose={() => {
          if (lockMutation.isPending) return;
          setLockOpen(false);
          setLockReason("");
        }}
      >
        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor="lock-reason" className="text-xs font-medium text-muted-foreground">
            Reason (recorded in the audit log, max 50 chars)
          </label>
          <textarea
            id="lock-reason"
            value={lockReason}
            onChange={(e) => setLockReason(e.target.value)}
            rows={3}
            maxLength={50}
            placeholder="e.g. suspicious activity, security review..."
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {lockMutation.isError && (
            <p className="text-xs text-destructive">{errorMessage(lockMutation.error, "Failed to lock user.")}</p>
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={unlockOpen}
        title="Unlock account"
        description={user ? `Lifts the lock on ${user.full_name || user.email}'s account.` : undefined}
        confirmLabel="Unlock"
        loading={unlockMutation.isPending}
        onConfirm={() => unlockMutation.mutate()}
        onClose={() => {
          if (unlockMutation.isPending) return;
          setUnlockOpen(false);
        }}
      >
        {unlockMutation.isError && (
          <p className="mt-2 text-xs text-destructive">{errorMessage(unlockMutation.error, "Failed to unlock user.")}</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
