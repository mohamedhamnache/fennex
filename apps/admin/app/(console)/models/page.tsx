"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart } from "@tremor/react";
import { AlertTriangle, Boxes, Gauge, Info, Sparkles, Wallet } from "lucide-react";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import { StatCard } from "@/components/kpi/StatCard";
import { ChartCard } from "@/components/charts/ChartCard";
import { EmptyChartState } from "@/components/charts/EmptyChartState";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import { compactNumber, moneyPer1k, moneyUsd } from "@/lib/format";
import type { ModelRow } from "@/lib/admin-types";

type Range = "24h" | "7d" | "30d" | "90d";

interface ModelAnalytics {
  items: ModelRow[];
  cheapest: { provider: string; model: string } | null;
}

const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

/** Top N models shown on the cost-by-model chart — the full table below
 * still lists every row, this is just the ranking visual. */
const CHART_TOP_N = 8;

/** `band` comes from `model_catalog` and is `null` for a model Fennex has
 * called but never registered in the catalog — rendered as an honest
 * "Unclassified" muted badge rather than guessing a tier. */
function BandBadge({ band }: { band: string | null }) {
  if (!band) {
    return <span className="badge bg-muted text-muted-foreground">Unclassified</span>;
  }
  const toneClass =
    band === "cheap"
      ? "bg-success/10 text-success"
      : band === "premium"
        ? "bg-warning/10 text-warning"
        : "bg-info/10 text-info";
  return <span className={cn("badge capitalize", toneClass)}>{band}</span>;
}

function ModelsSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading model analytics">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card-base border border-border bg-card p-4">
            <div className="skeleton mb-3 h-3 w-24" />
            <div className="skeleton h-7 w-28" />
          </div>
        ))}
      </div>
      <div className="card-base border border-border bg-card p-4">
        <div className="skeleton h-64 w-full" />
      </div>
      <div className="card-base border border-border bg-card p-4">
        <div className="skeleton h-72 w-full" />
      </div>
    </div>
  );
}

export default function ModelsPage() {
  const [range, setRange] = useState<Range>("30d");

  const modelsQuery = useQuery({
    queryKey: ["admin", "analytics", "models", range],
    queryFn: () => apiClient.get<ModelAnalytics>(`/admin/analytics/models?range=${range}`),
  });

  const items = useMemo(
    () => [...(modelsQuery.data?.items ?? [])].sort((a, b) => b.cost_usd - a.cost_usd),
    [modelsQuery.data],
  );
  const cheapest = modelsQuery.data?.cheapest ?? null;

  const totalCost = items.reduce((sum, r) => sum + r.cost_usd, 0);
  const totalTokens = items.reduce((sum, r) => sum + r.input_tokens + r.output_tokens, 0);
  const blendedCostPer1k = totalTokens > 0 ? totalCost / (totalTokens / 1000) : 0;

  const chartData = items.slice(0, CHART_TOP_N).map((r) => ({
    label: `${r.provider}/${r.model}`,
    cost: r.cost_usd,
  }));

  const columns: DataTableColumn<ModelRow>[] = [
    { key: "provider", header: "Provider" },
    { key: "model", header: "Model", mono: true },
    { key: "band", header: "Band", render: (row) => <BandBadge band={row.band} /> },
    {
      key: "requests",
      header: "Requests",
      mono: true,
      align: "right",
      render: (row) => row.requests.toLocaleString("en-US"),
    },
    {
      key: "input_tokens",
      header: "Input tokens",
      mono: true,
      align: "right",
      render: (row) => compactNumber(row.input_tokens),
    },
    {
      key: "output_tokens",
      header: "Output tokens",
      mono: true,
      align: "right",
      render: (row) => compactNumber(row.output_tokens),
    },
    {
      key: "cost_usd",
      header: "Cost",
      mono: true,
      align: "right",
      render: (row) => moneyUsd(row.cost_usd),
    },
    {
      key: "cost_per_1k_tokens",
      header: "Cost / 1k tokens",
      mono: true,
      align: "right",
      render: (row) => moneyPer1k(row.cost_per_1k_tokens),
    },
  ];

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">Model Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Spend and efficiency per LLM model actually in use — which models cost the most, and which are the
            cheapest per unit of work.
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

      {modelsQuery.isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load model analytics. Check the API connection and try again.
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 translate-y-0.5" aria-hidden="true" />
        Latency &amp; success rate — not instrumented yet.
      </div>

      {modelsQuery.isLoading ? (
        <ModelsSkeleton />
      ) : (
        <>
          {cheapest && (
            <div className="flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              Cheapest default:{" "}
              <span className="font-mono font-medium tabular-nums">
                {cheapest.provider}/{cheapest.model}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard label="Models in use" value={items.length.toLocaleString("en-US")} icon={Boxes} hint={`range: ${range}`} />
            <StatCard label="Total LLM cost" value={moneyUsd(totalCost)} icon={Wallet} hint={`range: ${range}`} />
            <StatCard
              label="Blended cost / 1k tokens"
              value={moneyPer1k(blendedCostPer1k)}
              icon={Gauge}
              hint="cost / (tokens / 1000)"
            />
          </div>

          <ChartCard title="Cost by model" hint={`top ${Math.min(CHART_TOP_N, chartData.length)}`}>
            {chartData.length === 0 ? (
              <EmptyChartState message="No model spend for this range yet." />
            ) : (
              <div role="img" aria-label="Cost by model, highest first" className="font-mono">
                <BarChart
                  className="h-72"
                  data={chartData}
                  index="label"
                  categories={["cost"]}
                  colors={["indigo"]}
                  layout="vertical"
                  valueFormatter={moneyUsd}
                  showLegend={false}
                  showAnimation
                  animationDuration={280}
                  yAxisWidth={160}
                />
              </div>
            )}
          </ChartCard>

          <DataTable
            columns={columns}
            rows={items}
            rowKey={(row) => `${row.provider}:${row.model}`}
            empty={
              <div className="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                <Boxes className="h-5 w-5" aria-hidden="true" />
                <span className="text-sm">No model data for this range yet.</span>
              </div>
            }
          />
        </>
      )}
    </div>
  );
}
