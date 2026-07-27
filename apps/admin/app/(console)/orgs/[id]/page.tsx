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
  Check,
  Copy,
  FolderKanban,
  Info,
  KeyRound,
  RotateCcw,
  ShieldAlert,
  Users,
  Wallet,
  Zap,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import { StatCard } from "@/components/kpi/StatCard";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { RoleGate } from "@/components/common/RoleGate";
import { money, compactNumber } from "@/lib/format";
import type { AdminOrgDetail, AdminImpersonateResult } from "@/lib/admin-types";

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

interface ProjectRow {
  id: string;
  name: string;
  domain: string;
  created_at: string;
}

/** Shows the token/owner returned by a successful impersonate call. Honest
 * MVP per the Task 9 brief: the endpoint really does mint a session for the
 * org's owner (and it's audited), but there's no receiver app wired up yet
 * to consume the token — so this dialog surfaces it for a human to copy
 * rather than pretending to open an authenticated session. */
function ImpersonateResultDialog({
  result,
  onClose,
}: {
  result: AdminImpersonateResult | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!result) return null;

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.access_token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API unavailable/denied — the token is still selectable in the input
    }
  }

  return (
    <div
      className="cmd-overlay fixed inset-0 z-50 flex items-center justify-center px-4 motion-safe:animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="impersonate-result-title"
        className="popover w-full max-w-md p-5 motion-safe:animate-scale-in"
      >
        <h2 id="impersonate-result-title" className="font-display text-lg font-semibold text-foreground">
          Impersonation session created
        </h2>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Owner</span>
            <p className="mt-0.5 text-sm text-foreground">
              {result.user.full_name || result.user.email}{" "}
              <span className="font-mono text-xs text-muted-foreground">{result.user.email}</span>
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
              Access token
            </span>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={result.access_token}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Impersonation access token"
                className="h-9 flex-1 truncate rounded-lg border border-border bg-muted/30 px-2.5 font-mono text-xs text-foreground"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                {copied ? "Copied" : "Copy token"}
              </button>
            </div>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              Expires in {Math.max(1, Math.round(result.expires_in / 60))} min
            </span>
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Opens a customer session as this owner — cross-app auto-login is a later task.</span>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-[40px] cursor-pointer items-center rounded-lg bg-primary px-3.5 text-sm font-semibold text-primary-foreground transition-colors duration-150 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** One row of the Actions panel: an icon, a label/description, and a
 * RoleGate-wrapped trigger button. Kept as a small local component since
 * every action follows the same shape (only the button contents differ). */
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

export default function OrgDetailPage() {
  const params = useParams<{ id: string }>();
  const orgId = params.id;
  const queryClient = useQueryClient();
  const queryKey = ["admin", "org", orgId];

  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [unsuspendOpen, setUnsuspendOpen] = useState(false);
  const [resetQuotasOpen, setResetQuotasOpen] = useState(false);
  const [impersonateConfirmOpen, setImpersonateConfirmOpen] = useState(false);
  const [impersonateResult, setImpersonateResult] = useState<AdminImpersonateResult | null>(null);

  const orgQuery = useQuery({
    queryKey,
    queryFn: () => apiClient.get<AdminOrgDetail>(`/admin/orgs/${orgId}`),
    enabled: !!orgId,
  });

  const org = orgQuery.data;

  const invalidateOrg = () => queryClient.invalidateQueries({ queryKey });

  const suspendMutation = useMutation({
    mutationFn: (reason: string) => apiClient.post(`/admin/orgs/${orgId}/suspend`, { reason: reason || undefined }),
    onSuccess: () => {
      invalidateOrg();
      setSuspendOpen(false);
      setSuspendReason("");
    },
  });

  const unsuspendMutation = useMutation({
    mutationFn: () => apiClient.post(`/admin/orgs/${orgId}/unsuspend`, {}),
    onSuccess: () => {
      invalidateOrg();
      setUnsuspendOpen(false);
    },
  });

  const resetQuotasMutation = useMutation({
    mutationFn: () => apiClient.post(`/admin/orgs/${orgId}/reset-quotas`, {}),
    onSuccess: () => {
      invalidateOrg();
      setResetQuotasOpen(false);
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: () => apiClient.post<AdminImpersonateResult>(`/admin/orgs/${orgId}/impersonate`, {}),
    onSuccess: (data) => {
      setImpersonateConfirmOpen(false);
      setImpersonateResult(data);
    },
  });

  const projectColumns: DataTableColumn<ProjectRow>[] = [
    { key: "name", header: "Name" },
    {
      key: "domain",
      header: "Domain",
      render: (row) => row.domain || <span className="text-muted-foreground">—</span>,
    },
    { key: "created_at", header: "Created", render: (row) => formatDate(row.created_at) },
  ];

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-6 p-6">
      <Link
        href="/orgs"
        className="inline-flex w-fit items-center gap-1.5 rounded text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to organizations
      </Link>

      {orgQuery.isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load this organization. Check the API connection and try again.
        </div>
      )}

      {orgQuery.isLoading && (
        <div className="flex flex-col gap-6">
          <div className="skeleton h-9 w-64" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-24 w-full" />
            ))}
          </div>
        </div>
      )}

      {org && (
        <>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-semibold text-foreground">{org.name}</h1>
                <span className="badge bg-secondary text-secondary-foreground capitalize">{org.plan_tier}</span>
                {org.byok_enabled && (
                  <span className="badge bg-info/10 text-info">
                    <KeyRound className="h-3 w-3" aria-hidden="true" />
                    BYOK
                  </span>
                )}
                {org.suspended ? (
                  <span className="badge bg-destructive/10 text-destructive">
                    <Ban className="h-3 w-3" aria-hidden="true" />
                    Suspended
                  </span>
                ) : (
                  <span className="badge bg-muted text-muted-foreground">
                    <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                    Active
                  </span>
                )}
              </div>
              <p className="mt-1 font-mono text-xs text-muted-foreground">{org.slug}</p>
              {org.suspended && org.suspended_reason && (
                <p className="mt-1 text-xs text-destructive">Reason: {org.suspended_reason}</p>
              )}
            </div>
          </header>

          <dl className="card-base card-shadow grid grid-cols-2 gap-x-4 gap-y-3 border border-border bg-card p-4 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Created</dt>
              <dd className="mt-0.5 font-mono tabular-nums text-foreground">{formatDate(org.created_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Trial ends</dt>
              <dd className="mt-0.5 font-mono tabular-nums text-foreground">{formatDate(org.trial_ends_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Stripe customer</dt>
              <dd className="mt-0.5 truncate font-mono text-foreground" title={org.stripe_customer_id ?? undefined}>
                {org.stripe_customer_id ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">SEO items</dt>
              <dd className="mt-0.5 font-mono tabular-nums text-foreground">{compactNumber(org.seo_count)}</dd>
            </div>
          </dl>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Monthly cost" value={money(org.cost_micros)} icon={Wallet} />
            <StatCard label="Users" value={org.user_count.toLocaleString("en-US")} icon={Users} />
            <StatCard label="Projects" value={org.project_count.toLocaleString("en-US")} icon={FolderKanban} />
            <StatCard label="AI requests" value={compactNumber(org.ai_requests)} icon={Zap} />
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="font-display text-sm font-semibold text-foreground">Projects</h2>
            <DataTable
              columns={projectColumns}
              rows={org.projects}
              rowKey={(row) => row.id}
              empty={
                <div className="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <FolderKanban className="h-5 w-5" aria-hidden="true" />
                  <span className="text-sm">No projects yet.</span>
                </div>
              }
            />
          </div>

          <div className="card-base card-shadow flex flex-col divide-y divide-border border border-border bg-card p-4">
            <h2 className="pb-1 font-display text-sm font-semibold text-foreground">Actions</h2>

            <RoleGate permission="org.suspend">
              {!org.suspended ? (
                <ActionRow
                  icon={Ban}
                  label="Suspend organization"
                  description="Immediately blocks this organization from accessing the platform."
                >
                  <button
                    type="button"
                    onClick={() => setSuspendOpen(true)}
                    className={cn(actionButtonClass, "border-destructive/40 text-destructive hover:bg-destructive/10")}
                  >
                    <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                    Suspend
                  </button>
                </ActionRow>
              ) : (
                <ActionRow
                  icon={CheckCircle2}
                  label="Unsuspend organization"
                  description="Restores this organization's access immediately."
                >
                  <button
                    type="button"
                    onClick={() => setUnsuspendOpen(true)}
                    className={cn(actionButtonClass, "border-border text-foreground hover:bg-accent")}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    Unsuspend
                  </button>
                </ActionRow>
              )}
            </RoleGate>

            <RoleGate permission="org.reset_quotas">
              <ActionRow
                icon={RotateCcw}
                label="Reset quotas"
                description="Resets this billing period's usage counters back to zero. Cannot be undone."
              >
                <button
                  type="button"
                  onClick={() => setResetQuotasOpen(true)}
                  className={cn(actionButtonClass, "border-destructive/40 text-destructive hover:bg-destructive/10")}
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reset quotas
                </button>
              </ActionRow>
            </RoleGate>

            <RoleGate permission="org.impersonate">
              <ActionRow
                icon={ShieldAlert}
                label="Impersonate owner"
                description="Mints a short-lived session token for this org's owner. Audited."
              >
                <button
                  type="button"
                  onClick={() => setImpersonateConfirmOpen(true)}
                  className={cn(actionButtonClass, "border-border text-foreground hover:bg-accent")}
                >
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  Impersonate
                </button>
              </ActionRow>
            </RoleGate>
          </div>
        </>
      )}

      <ConfirmDialog
        open={suspendOpen}
        title="Suspend organization"
        description={org ? `This immediately blocks ${org.name} from accessing the platform.` : undefined}
        confirmLabel="Suspend"
        destructive
        loading={suspendMutation.isPending}
        onConfirm={() => suspendMutation.mutate(suspendReason)}
        onClose={() => {
          if (suspendMutation.isPending) return;
          setSuspendOpen(false);
          setSuspendReason("");
        }}
      >
        <div className="mt-3 flex flex-col gap-1.5">
          <label htmlFor="suspend-reason" className="text-xs font-medium text-muted-foreground">
            Reason (recorded in the audit log)
          </label>
          <textarea
            id="suspend-reason"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            rows={3}
            placeholder="e.g. payment failed, ToS violation..."
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {suspendMutation.isError && (
            <p className="text-xs text-destructive">{errorMessage(suspendMutation.error, "Failed to suspend organization.")}</p>
          )}
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={unsuspendOpen}
        title="Unsuspend organization"
        description={org ? `Restores ${org.name}'s access immediately.` : undefined}
        confirmLabel="Unsuspend"
        loading={unsuspendMutation.isPending}
        onConfirm={() => unsuspendMutation.mutate()}
        onClose={() => {
          if (unsuspendMutation.isPending) return;
          setUnsuspendOpen(false);
        }}
      >
        {unsuspendMutation.isError && (
          <p className="mt-2 text-xs text-destructive">{errorMessage(unsuspendMutation.error, "Failed to unsuspend organization.")}</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={resetQuotasOpen}
        title="Reset quotas"
        description={
          org ? `Resets ${org.name}'s usage counters for this billing period back to zero. This cannot be undone.` : undefined
        }
        confirmLabel="Reset quotas"
        destructive
        loading={resetQuotasMutation.isPending}
        onConfirm={() => resetQuotasMutation.mutate()}
        onClose={() => {
          if (resetQuotasMutation.isPending) return;
          setResetQuotasOpen(false);
        }}
      >
        {resetQuotasMutation.isError && (
          <p className="mt-2 text-xs text-destructive">{errorMessage(resetQuotasMutation.error, "Failed to reset quotas.")}</p>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={impersonateConfirmOpen}
        title="Impersonate owner"
        description={
          org
            ? `Mints a session token for ${org.name}'s owner. This action is recorded in the audit log.`
            : undefined
        }
        confirmLabel="Impersonate"
        loading={impersonateMutation.isPending}
        onConfirm={() => impersonateMutation.mutate()}
        onClose={() => {
          if (impersonateMutation.isPending) return;
          setImpersonateConfirmOpen(false);
        }}
      >
        {impersonateMutation.isError && (
          <p className="mt-2 text-xs text-destructive">{errorMessage(impersonateMutation.error, "Failed to create impersonation session.")}</p>
        )}
      </ConfirmDialog>

      <ImpersonateResultDialog result={impersonateResult} onClose={() => setImpersonateResult(null)} />
    </div>
  );
}
