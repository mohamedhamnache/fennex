"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  Building2,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  Layers,
  Share2,
  TrendingUp,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import { StatCard } from "@/components/kpi/StatCard";
import { compactNumber, moneyUsd } from "@/lib/format";
import type { PlanRow } from "@/lib/admin-types";

/** Canonical plan progression (mirrors `app/core/billing.py#PLAN_LIMITS`) —
 * rows render in this order rather than however the API happens to return
 * them. A plan the frontend doesn't know about yet is appended
 * alphabetically after the known tiers instead of being dropped. */
const PLAN_ORDER = ["free", "starter", "pro", "agency", "scale"];

function sortPlans(rows: PlanRow[]): PlanRow[] {
  return [...rows].sort((a, b) => {
    const ai = PLAN_ORDER.indexOf(a.plan);
    const bi = PLAN_ORDER.indexOf(b.plan);
    if (ai === -1 && bi === -1) return a.plan.localeCompare(b.plan);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

/** `price_usd` is `0` for two different reasons — the free tier (genuinely
 * $0) and custom-quoted enterprise-style tiers (priced outside Stripe's
 * fixed catalog) — so the label is chosen from the plan name, not just the
 * number, rather than showing "$0/mo" for either. Non-zero prices are whole
 * dollars in practice (`$29`, `$79`, ...) but fractional cents still render
 * correctly if they ever appear. */
function planPriceLabel(row: PlanRow): string {
  if (row.price_usd > 0) {
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: row.price_usd % 1 === 0 ? 0 : 2,
    }).format(row.price_usd);
    return `${formatted}/mo`;
  }
  return row.plan === "free" ? "Free" : "Custom";
}

/** `-1` is the sentinel for "unlimited" throughout `PLAN_LIMITS` — rendered
 * as a word rather than a number so it can't be misread as a real cap. */
function limitLabel(value: number): string {
  return value === -1 ? "Unlimited" : value.toLocaleString("en-US");
}

function LimitStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FolderKanban;
  label: string;
  value: number;
}) {
  const unlimited = value === -1;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1 text-2xs uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden="true" />
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-sm tabular-nums text-foreground",
          unlimited && "text-info",
        )}
      >
        {limitLabel(value)}
      </span>
    </div>
  );
}

function PlanCard({ row }: { row: PlanRow }) {
  return (
    <div className="card-base card-shadow motion-safe:animate-fade-in flex flex-col gap-4 border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="badge bg-secondary text-secondary-foreground capitalize">
          <Layers className="h-3 w-3" aria-hidden="true" />
          {row.plan}
        </span>
        <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
          {planPriceLabel(row)}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 border-b border-border pb-4">
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-2xs uppercase tracking-wide text-muted-foreground">
            <Building2 className="h-3 w-3" aria-hidden="true" />
            Orgs
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
            {compactNumber(row.org_count)}
          </span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-2xs uppercase tracking-wide text-muted-foreground">
            <Banknote className="h-3 w-3" aria-hidden="true" />
            MRR
          </span>
          <span className="font-mono text-lg font-semibold tabular-nums text-foreground">
            {moneyUsd(row.mrr_usd)}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <LimitStat icon={FolderKanban} label="Projects" value={row.limits.projects} />
        <LimitStat icon={FileText} label="Articles" value={row.limits.articles} />
        <LimitStat icon={ImageIcon} label="Images" value={row.limits.images} />
        <LimitStat icon={Share2} label="Social" value={row.limits.social} />
      </div>
    </div>
  );
}

function PlanCardSkeleton() {
  return (
    <div className="card-base border border-border bg-card p-4" aria-hidden="true">
      <div className="flex items-start justify-between gap-2">
        <div className="skeleton h-5 w-20 rounded-full" />
        <div className="skeleton h-5 w-16" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-b border-border pb-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="skeleton h-2.5 w-12" />
            <div className="skeleton h-5 w-16" />
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="skeleton h-2.5 w-12" />
            <div className="skeleton h-4 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

function PlansSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading plans">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card-base border border-border bg-card p-4">
            <div className="skeleton mb-3 h-3 w-20" />
            <div className="skeleton h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <PlanCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export default function PlansPage() {
  const plansQuery = useQuery({
    queryKey: ["admin", "billing", "plans"],
    queryFn: () => apiClient.get<{ items: PlanRow[] }>("/admin/billing/plans"),
  });

  const rows = sortPlans(plansQuery.data?.items ?? []);
  const totalMrr = rows.reduce((sum, r) => sum + r.mrr_usd, 0);
  const totalOrgs = rows.reduce((sum, r) => sum + r.org_count, 0);

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-6 p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold text-foreground">Plans</h1>
        <p className="text-sm text-muted-foreground">
          Plan catalog, current limits, and each plan's contribution to monthly recurring revenue.
        </p>
      </header>

      {plansQuery.isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load plan data. Check the API connection and try again.
        </div>
      )}

      {plansQuery.isLoading ? (
        <PlansSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Total MRR" value={moneyUsd(totalMrr)} icon={TrendingUp} hint="across all plans" />
            <StatCard label="Orgs on a plan" value={compactNumber(totalOrgs)} icon={Building2} />
            <StatCard label="Plans configured" value={compactNumber(rows.length)} icon={Layers} />
          </div>

          {rows.length === 0 ? (
            <div className="card-base card-shadow flex flex-col items-center justify-center gap-2 border border-border bg-card p-12 text-center text-muted-foreground">
              <Layers className="h-5 w-5" aria-hidden="true" />
              <span className="text-sm">No plans configured yet.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <PlanCard key={row.plan} row={row} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
