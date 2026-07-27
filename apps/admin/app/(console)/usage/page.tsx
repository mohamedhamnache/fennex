"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { Color } from "@tremor/react";
import { AlertTriangle, Boxes, Layers, SlidersHorizontal, Wallet } from "lucide-react";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import { StatCard } from "@/components/kpi/StatCard";
import { AreaTrend } from "@/components/charts/AreaTrend";
import { ChartCard } from "@/components/charts/ChartCard";
import { EmptyChartState } from "@/components/charts/EmptyChartState";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import { compactNumber, moneyUsd } from "@/lib/format";
import type { UsageExplorer } from "@/lib/admin-types";

type Metric = "cost" | "tokens" | "requests" | "seo";
type GroupBy = "provider" | "model" | "org" | "unit";
type Range = "24h" | "7d" | "30d" | "90d";

type GroupRow = UsageExplorer["groups"][number];

const METRICS: { value: Metric; label: string }[] = [
  { value: "cost", label: "Cost" },
  { value: "tokens", label: "Tokens" },
  { value: "requests", label: "Requests" },
  { value: "seo", label: "SEO credits" },
];

const GROUP_BYS: { value: GroupBy; label: string }[] = [
  { value: "provider", label: "Provider" },
  { value: "model", label: "Model" },
  { value: "org", label: "Org" },
  { value: "unit", label: "Unit" },
];

const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

/** Trend line color per metric — kept inside the console's cool palette
 * (no ambers/reds, which the design system reserves for warning/error
 * states) while still giving each metric a distinct hue. */
const METRIC_COLOR: Record<Metric, Color> = {
  cost: "emerald",
  tokens: "violet",
  requests: "blue",
  seo: "cyan",
};

/** The crux of this page: `groups`/`series` values arrive from the API
 * already in the unit the selected metric implies — whole dollars for
 * `cost`, raw counts for everything else. Formatting must switch on
 * `metric`, never inspect the number itself (a cost of exactly `12` and a
 * request count of `12` must not render the same way). */
function formatByMetric(metric: Metric, value: number): string {
  return metric === "cost" ? moneyUsd(value) : compactNumber(value);
}

function metricLabel(metric: Metric): string {
  return METRICS.find((m) => m.value === metric)!.label;
}

function groupByLabel(groupBy: GroupBy): string {
  return GROUP_BYS.find((g) => g.value === groupBy)!.label;
}

function UsageExplorerSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading usage explorer">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card-base border border-border bg-card p-4">
            <div className="skeleton mb-3 h-3 w-24" />
            <div className="skeleton h-7 w-28" />
          </div>
        ))}
      </div>
      <div className="card-base border border-border bg-card p-4">
        <div className="skeleton mb-3 h-4 w-32" />
        <div className="skeleton h-64 w-full" />
      </div>
      <div className="card-base border border-border bg-card p-4">
        <div className="skeleton h-72 w-full" />
      </div>
    </div>
  );
}

export default function UsagePage() {
  const [metric, setMetric] = useState<Metric>("cost");
  const [groupBy, setGroupBy] = useState<GroupBy>("provider");
  const [range, setRange] = useState<Range>("30d");

  const usageQuery = useQuery({
    queryKey: ["admin", "analytics", "usage", metric, groupBy, range],
    queryFn: () =>
      apiClient.get<UsageExplorer>(
        `/admin/analytics/usage?metric=${metric}&group_by=${groupBy}&range=${range}`,
      ),
  });

  const series = usageQuery.data?.series ?? [];
  const seriesHasData = series.length > 0 && series.some((p) => p.value !== 0);

  const groups = useMemo(
    () => [...(usageQuery.data?.groups ?? [])].sort((a, b) => b.value - a.value),
    [usageQuery.data],
  );
  const totalValue = groups.reduce((sum, g) => sum + g.value, 0);

  const columns: DataTableColumn<GroupRow>[] = [
    {
      key: "label",
      header: groupByLabel(groupBy),
      render: (row) =>
        groupBy === "org" ? (
          <Link
            href={`/orgs/${row.key}`}
            className="rounded text-sm font-medium text-foreground transition-colors duration-150 hover:text-primary hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.label || "—"}
          </Link>
        ) : (
          // SEO rows carry an empty model; show a dash rather than a blank cell.
          row.label || <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "value",
      header: metricLabel(metric),
      mono: true,
      align: "right",
      render: (row) => formatByMetric(metric, row.value),
    },
  ];

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Usage Explorer</h1>
          <p className="text-sm text-muted-foreground">
            Cross-cutting usage and cost — pick a metric, slice it by provider, model, org, or SEO unit.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
              aria-label="Metric"
              className="h-9 cursor-pointer rounded-lg border border-border bg-card px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            aria-label="Group by"
            className="h-9 cursor-pointer rounded-lg border border-border bg-card px-2.5 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {GROUP_BYS.map((g) => (
              <option key={g.value} value={g.value}>
                By {g.label}
              </option>
            ))}
          </select>

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
        </div>
      </header>

      {usageQuery.isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load usage data. Check the API connection and try again.
        </div>
      )}

      {usageQuery.isLoading ? (
        <UsageExplorerSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StatCard
              label={`Total ${metricLabel(metric).toLowerCase()}`}
              value={formatByMetric(metric, totalValue)}
              icon={metric === "cost" ? Wallet : Layers}
              hint={`range: ${range}`}
            />
            <StatCard
              label={`${groupByLabel(groupBy)}s tracked`}
              value={compactNumber(groups.length)}
              icon={Boxes}
              hint={`grouped by ${groupBy}`}
            />
          </div>

          <ChartCard title={`${metricLabel(metric)} over time`} hint={`range: ${range} · by ${groupBy}`}>
            {seriesHasData ? (
              <AreaTrend
                data={series}
                valueFormatter={(v) => formatByMetric(metric, v)}
                color={METRIC_COLOR[metric]}
                ariaLabel={`Daily ${metricLabel(metric).toLowerCase()} trend for the last ${range}`}
              />
            ) : (
              <EmptyChartState message="No usage in this range." />
            )}
          </ChartCard>

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              {metricLabel(metric)} by {groupByLabel(groupBy).toLowerCase()}
            </h2>
            <DataTable
              columns={columns}
              rows={groups}
              rowKey={(row) => row.key}
              empty={
                <div className="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <Layers className="h-5 w-5" aria-hidden="true" />
                  <span className="text-sm">No usage in this range.</span>
                </div>
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
