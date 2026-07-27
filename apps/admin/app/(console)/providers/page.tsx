"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Cpu,
  Hash,
  Info,
  PauseCircle,
  Search,
  Server,
  Wallet,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import { StatCard } from "@/components/kpi/StatCard";
import { compactNumber, moneyUsd } from "@/lib/format";
import type { ProviderRow } from "@/lib/admin-types";

type Range = "24h" | "7d" | "30d" | "90d";

interface ProviderAnalytics {
  items: ProviderRow[];
  totals: { requests: number; cost_usd: number };
}

const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

/** Badge styling per provider `kind` — LLM providers (Anthropic, OpenAI, ...)
 * read as the "core" info-toned category; everything else (DataForSEO, ...)
 * gets a neutral secondary tone rather than implying a hierarchy. */
function KindBadge({ kind }: { kind: string }) {
  const isLlm = kind.toLowerCase() === "llm";
  return (
    <span className={cn("badge capitalize", isLlm ? "bg-info/10 text-info" : "bg-secondary text-secondary-foreground")}>
      {isLlm ? <Cpu className="h-3 w-3" aria-hidden="true" /> : <Search className="h-3 w-3" aria-hidden="true" />}
      {kind}
    </span>
  );
}

/** Three honest states rather than a single configured/unconfigured toggle —
 * a provider can have credentials on file but be switched off, and that's a
 * meaningfully different situation from never having been set up. */
function StatusPill({ row }: { row: ProviderRow }) {
  if (!row.is_configured) {
    return (
      <span className="badge bg-destructive/10 text-destructive">
        <Ban className="h-3 w-3" aria-hidden="true" />
        Not configured
      </span>
    );
  }
  if (!row.is_active) {
    return (
      <span className="badge bg-muted text-muted-foreground">
        <PauseCircle className="h-3 w-3" aria-hidden="true" />
        Inactive
      </span>
    );
  }
  return (
    <span className="badge bg-success/10 text-success">
      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      Active
    </span>
  );
}

function BudgetBar({ row }: { row: ProviderRow }) {
  if (row.monthly_budget_usd == null || row.monthly_budget_usd <= 0) return null;

  const ratio = row.mtd_cost_usd / row.monthly_budget_usd;
  const pctWidth = Math.min(100, Math.max(0, ratio * 100));
  const isOver = ratio >= 1;
  const isNear = ratio >= 0.8 && !isOver;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Wallet className="h-3 w-3" aria-hidden="true" />
          MTD budget
        </span>
        <span className={cn("font-mono tabular-nums", isOver && "font-semibold text-destructive")}>
          {moneyUsd(row.mtd_cost_usd)} / {moneyUsd(row.monthly_budget_usd)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="presentation">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300",
            isOver ? "bg-destructive" : isNear ? "bg-warning" : "bg-primary",
          )}
          style={{ width: `${pctWidth}%` }}
        />
      </div>
    </div>
  );
}

function ProviderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function ProviderCard({ row }: { row: ProviderRow }) {
  const totalTokens = row.input_tokens + row.output_tokens;
  return (
    <div className="card-base card-shadow motion-safe:animate-fade-in flex flex-col gap-4 border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-foreground">{row.provider}</span>
          <KindBadge kind={row.kind} />
        </div>
        <StatusPill row={row} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ProviderStat label="Requests" value={compactNumber(row.requests)} />
        <ProviderStat label="Tokens" value={compactNumber(totalTokens)} />
        <ProviderStat label="Cost" value={moneyUsd(row.cost_usd)} />
        <ProviderStat label="Models" value={row.model_count.toLocaleString("en-US")} />
      </div>

      <BudgetBar row={row} />
    </div>
  );
}

function ProviderCardSkeleton() {
  return (
    <div className="card-base border border-border bg-card p-4" aria-hidden="true">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-2">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton h-5 w-16 rounded-full" />
        </div>
        <div className="skeleton h-5 w-20 rounded-full" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="skeleton h-2.5 w-12" />
            <div className="skeleton h-4 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProvidersPage() {
  const [range, setRange] = useState<Range>("30d");

  const providersQuery = useQuery({
    queryKey: ["admin", "analytics", "providers", range],
    queryFn: () => apiClient.get<ProviderAnalytics>(`/admin/analytics/providers?range=${range}`),
  });

  const items = providersQuery.data?.items ?? [];
  const totals = providersQuery.data?.totals;
  const activeCount = items.filter((r) => r.is_configured && r.is_active).length;
  const totalTokens = items.reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0);

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">AI Providers</h1>
          <p className="text-sm text-muted-foreground">
            Configuration, usage, and spend across every AI and SEO data provider.
          </p>
        </div>

        <div
          role="group"
          aria-label="Time range"
          className="flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
        >
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setRange(r.value)}
              aria-pressed={range === r.value}
              className={cn(
                "cursor-pointer rounded-md px-2.5 py-1 font-mono text-xs font-medium tabular-nums transition-colors duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                range === r.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {providersQuery.isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load provider analytics. Check the API connection and try again.
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 translate-y-0.5" aria-hidden="true" />
        Latency &amp; error rate — not instrumented yet.
      </div>

      {providersQuery.isLoading ? (
        <ProvidersSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Active providers"
              value={`${activeCount}/${items.length}`}
              icon={Server}
              hint="configured & active"
            />
            <StatCard
              label="Total AI requests"
              value={compactNumber(totals?.requests ?? 0)}
              icon={Cpu}
              hint={`range: ${range}`}
            />
            <StatCard
              label="Total cost"
              value={moneyUsd(totals?.cost_usd ?? 0)}
              icon={Wallet}
              hint={`range: ${range}`}
            />
            <StatCard label="Total tokens" value={compactNumber(totalTokens)} icon={Hash} hint="input + output" />
          </div>

          {items.length === 0 ? (
            <div className="card-base card-shadow flex flex-col items-center justify-center gap-2 border border-border bg-card p-12 text-center text-muted-foreground">
              <Server className="h-5 w-5" aria-hidden="true" />
              <span className="text-sm">No provider data for this range yet.</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {items.map((row) => (
                <ProviderCard key={row.provider} row={row} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ProvidersSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading provider analytics">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card-base border border-border bg-card p-4">
            <div className="skeleton mb-3 h-3 w-20" />
            <div className="skeleton h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <ProviderCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
