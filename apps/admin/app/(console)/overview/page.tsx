"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download } from "lucide-react";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import { KpiGrid } from "@/components/kpi/KpiGrid";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { LineTrend } from "@/components/charts/LineTrend";
import { ChartCard } from "@/components/charts/ChartCard";
import { EmptyChartState } from "@/components/charts/EmptyChartState";
import { compactNumber, money } from "@/lib/format";
import type { OverviewKpis, OverviewRange, OverviewSeries } from "@/lib/overview-types";

const RANGES: { value: OverviewRange; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

export default function OverviewPage() {
  const [range, setRange] = useState<OverviewRange>("30d");

  // One query key per (endpoint, range) pair so switching the range selector
  // refetches independently and TanStack Query caches each range's answer
  // (60s staleTime from lib/query.ts) instead of refetching on every toggle.
  const kpisQuery = useQuery({
    queryKey: ["admin", "overview", "kpis", range],
    queryFn: () => apiClient.get<OverviewKpis>(`/admin/overview/kpis?range=${range}`),
  });
  const costSeriesQuery = useQuery({
    queryKey: ["admin", "overview", "series", "cost", range],
    queryFn: () => apiClient.get<OverviewSeries>(`/admin/overview/series?metric=cost&range=${range}`),
  });
  const requestsSeriesQuery = useQuery({
    queryKey: ["admin", "overview", "series", "requests", range],
    queryFn: () => apiClient.get<OverviewSeries>(`/admin/overview/series?metric=requests&range=${range}`),
  });

  const isLoading = kpisQuery.isLoading || costSeriesQuery.isLoading || requestsSeriesQuery.isLoading;
  const isError = kpisQuery.isError || costSeriesQuery.isError || requestsSeriesQuery.isError;

  const costPoints = costSeriesQuery.data?.points ?? [];
  const requestsPoints = requestsSeriesQuery.data?.points ?? [];
  const costHasData = costPoints.some((p) => p.value !== 0);
  const requestsHasData = requestsPoints.some((p) => p.value !== 0);

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Platform health across organizations, AI usage, and revenue.
          </p>
        </div>

        <div className="flex items-center gap-2">
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

          <button
            type="button"
            disabled
            title="CSV export — Phase 1b"
            aria-disabled="true"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground opacity-60"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Export
          </button>
        </div>
      </header>

      {isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load overview data. Check the API connection and try again.
        </div>
      )}

      {isLoading ? (
        <OverviewSkeleton />
      ) : (
        kpisQuery.data && (
          <>
            <KpiGrid kpis={kpisQuery.data} />

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <ChartCard title="Cost over time" hint={`range: ${range}`}>
                {costHasData ? (
                  <AreaTrend
                    data={costPoints}
                    valueFormatter={(v) => money(v)}
                    color="emerald"
                    ariaLabel={`Daily AI and infra cost for the last ${range}`}
                  />
                ) : (
                  <EmptyChartState message="No cost recorded for this range yet." />
                )}
              </ChartCard>

              <ChartCard title="API requests" hint={`range: ${range}`}>
                {requestsHasData ? (
                  <LineTrend
                    data={requestsPoints}
                    valueFormatter={(v) => compactNumber(v)}
                    color="blue"
                    ariaLabel={`Daily API request volume for the last ${range}`}
                  />
                ) : (
                  <EmptyChartState message="No API requests recorded for this range yet." />
                )}
              </ChartCard>
            </div>
          </>
        )
      )}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading overview">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 9 }).map((_, i) => (
          <div key={i} className="card-base border border-border bg-card p-4">
            <div className="skeleton mb-3 h-3 w-20" />
            <div className="skeleton h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="card-base border border-border bg-card p-4">
          <div className="skeleton mb-3 h-4 w-32" />
          <div className="skeleton h-64 w-full" />
        </div>
        <div className="card-base border border-border bg-card p-4">
          <div className="skeleton mb-3 h-4 w-32" />
          <div className="skeleton h-64 w-full" />
        </div>
      </div>
    </div>
  );
}
