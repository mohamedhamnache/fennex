"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, Building2, Info, Layers, Search, Wallet } from "lucide-react";
import { apiClient } from "@/lib/api";
import { cn } from "@/lib/cn";
import { StatCard } from "@/components/kpi/StatCard";
import { DataTable, type DataTableColumn } from "@/components/table/DataTable";
import { compactNumber, moneyUsd } from "@/lib/format";
import type { SeoAnalytics } from "@/lib/admin-types";

type Range = "24h" | "7d" | "30d" | "90d";

interface ByUnitRow {
  unit: string;
  count: number;
  cost_usd: number;
}

interface TopConsumerRow {
  org_id: string;
  org_name: string;
  seo_count: number;
  cost_usd: number;
}

const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
];

/** DataForSEO unit codes rendered as readable labels rather than raw
 * snake_case — `serp` and `keyword_ideas` are the two units Fennex actually
 * calls today; anything else still renders (title-cased) rather than
 * disappearing if a new unit shows up server-side. */
function unitLabel(unit: string): string {
  const known: Record<string, string> = {
    serp: "SERP",
    keyword_ideas: "Keyword ideas",
  };
  if (known[unit]) return known[unit];
  return unit
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function DataforseoSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading DataForSEO analytics">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card-base border border-border bg-card p-4">
            <div className="skeleton mb-3 h-3 w-24" />
            <div className="skeleton h-7 w-28" />
          </div>
        ))}
      </div>
      <div className="card-base border border-border bg-card p-4">
        <div className="skeleton h-40 w-full" />
      </div>
      <div className="card-base border border-border bg-card p-4">
        <div className="skeleton h-72 w-full" />
      </div>
    </div>
  );
}

export default function DataforseoPage() {
  const [range, setRange] = useState<Range>("30d");

  const seoQuery = useQuery({
    queryKey: ["admin", "analytics", "seo", range],
    queryFn: () => apiClient.get<SeoAnalytics>(`/admin/analytics/seo?range=${range}`),
  });

  const byUnit = useMemo(
    () => [...(seoQuery.data?.by_unit ?? [])].sort((a, b) => b.cost_usd - a.cost_usd),
    [seoQuery.data],
  );
  const topConsumers = useMemo(
    () => [...(seoQuery.data?.top_consumers ?? [])].sort((a, b) => b.cost_usd - a.cost_usd),
    [seoQuery.data],
  );

  const unitColumns: DataTableColumn<ByUnitRow>[] = [
    { key: "unit", header: "Unit", render: (row) => unitLabel(row.unit) },
    {
      key: "count",
      header: "Credits",
      mono: true,
      align: "right",
      render: (row) => compactNumber(row.count),
    },
    {
      key: "cost_usd",
      header: "Cost",
      mono: true,
      align: "right",
      render: (row) => moneyUsd(row.cost_usd),
    },
  ];

  const consumerColumns: DataTableColumn<TopConsumerRow>[] = [
    {
      key: "org_name",
      header: "Org",
      render: (row) => (
        <Link
          href={`/orgs/${row.org_id}`}
          className="rounded text-sm font-medium text-foreground transition-colors duration-150 hover:text-primary hover:underline hover:underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {row.org_name}
        </Link>
      ),
    },
    {
      key: "seo_count",
      header: "SEO credits",
      mono: true,
      align: "right",
      render: (row) => compactNumber(row.seo_count),
    },
    {
      key: "cost_usd",
      header: "Cost",
      mono: true,
      align: "right",
      render: (row) => moneyUsd(row.cost_usd),
    },
  ];

  return (
    <div className="motion-safe:animate-fade-in flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground">DataForSEO</h1>
          <p className="text-sm text-muted-foreground">
            SEO data provider usage and spend — request volume, credit consumption by unit, and which orgs drive it.
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

      {seoQuery.isError && (
        <div
          role="alert"
          className="card-base flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          Couldn't load DataForSEO analytics. Check the API connection and try again.
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <Info className="h-3.5 w-3.5 shrink-0 translate-y-0.5" aria-hidden="true" />
        Failed requests &amp; latency — not instrumented yet.
      </div>

      {seoQuery.isLoading ? (
        <DataforseoSkeleton />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatCard
              label="Total SEO requests"
              value={compactNumber(seoQuery.data?.total_requests ?? 0)}
              icon={Search}
              hint={`range: ${range}`}
            />
            <StatCard
              label="Total credits"
              value={compactNumber(seoQuery.data?.total_seo_count ?? 0)}
              icon={Layers}
              hint="SEO units consumed"
            />
            <StatCard
              label="Total cost"
              value={moneyUsd(seoQuery.data?.cost_usd ?? 0)}
              icon={Wallet}
              hint={`range: ${range}`}
            />
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-foreground">Usage by unit</h2>
            <DataTable
              columns={unitColumns}
              rows={byUnit}
              rowKey={(row) => row.unit}
              empty={
                <div className="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <Layers className="h-5 w-5" aria-hidden="true" />
                  <span className="text-sm">No DataForSEO usage for this range yet.</span>
                </div>
              }
            />
          </div>

          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-foreground">Top consumers</h2>
            <DataTable
              columns={consumerColumns}
              rows={topConsumers}
              rowKey={(row) => row.org_id}
              empty={
                <div className="flex flex-col items-center justify-center gap-2 text-center text-muted-foreground">
                  <Building2 className="h-5 w-5" aria-hidden="true" />
                  <span className="text-sm">No org has used DataForSEO in this range yet.</span>
                </div>
              }
            />
          </div>
        </>
      )}
    </div>
  );
}
