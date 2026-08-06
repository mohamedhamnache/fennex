"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Globe, Loader2, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import {
  connectGsc, exportStoreCsv, getStoreDashboard, syncStoreOrders,
  type StoreDashboardData,
} from "@/lib/api";
import {
  formatters, KpiCard, Section, Segmented, type Fmt,
} from "./primitives";
import {
  AlertsBar, BreakdownSection, ContentSection, CustomersSection, ForecastSection,
  FunnelSection, GeoSection, InsightsPanel, LiveSection, MarketingSection,
  OperationsSection, ProductsSection,
} from "./sections";

// Charts are the heaviest thing on the page and none of them are above the
// fold on a phone. Loading them separately keeps the KPIs interactive while
// recharts arrives.
const MainChart = dynamic(() => import("./charts").then((m) => ({ default: m.MainChart })), {
  ssr: false,
  loading: () => <div className="h-[300px] animate-pulse rounded-xl bg-muted/30" />,
});

/** The windows a merchant actually thinks in. */
const RANGES = [
  { key: "1", label: "Today" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "Quarter" },
  { key: "365", label: "Year" },
] as const;

const METRICS = [
  { key: "revenue", label: "Revenue" },
  { key: "orders", label: "Orders" },
  { key: "aov", label: "Avg order" },
  { key: "net_sales", label: "Net sales" },
  { key: "profit", label: "Profit" },
] as const;

const KPI_LABELS: Record<string, string> = {
  revenue: "Revenue", net_sales: "Net sales", orders: "Orders", aov: "Avg order value",
  conversion: "Conversion", sessions: "Sessions", returning_rate: "Returning rate",
  new_customers: "New customers", gross_profit: "Gross profit", margin: "Profit margin",
  roas: "ROAS", mer: "MER",
};

// Order matters: the four a merchant checks first come first, and the ones
// that need a connector we do not have come last. A grid sorted by importance
// means the top row answers "are we making money" without scrolling.
const KPI_ORDER = [
  "revenue", "orders", "aov", "gross_profit",
  "net_sales", "margin", "conversion", "sessions",
  "returning_rate", "new_customers", "roas", "mer",
];

// A lower value is better for exactly one of these.
const INVERTED = new Set<string>([]);

export function StoreDashboard({ projectId, gscConnected }: {
  projectId: string; gscConnected: boolean;
}) {
  const [days, setDays] = useState("30");
  const [metric, setMetric] = useState<"revenue" | "orders" | "aov" | "net_sales" | "profit">("revenue");
  const [compare, setCompare] = useState(true);
  const [movingAverage, setMovingAverage] = useState(false);
  const [showForecast, setShowForecast] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const qc = useQueryClient();
  const { success, error: toastError } = useToast();

  const n = Number(days);
  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ["store-dashboard", projectId, n],
    queryFn: () => getStoreDashboard(projectId, n),
    staleTime: 60_000,
    retry: false,
  });

  const fmt: Fmt = useMemo(() => formatters(data?.currency || "USD"), [data?.currency]);

  async function refresh() {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await syncStoreOrders(projectId);
      await qc.invalidateQueries({ queryKey: ["store-dashboard", projectId] });
      if (r.ok) success("Store synced", { message: `${r.synced} orders · ${r.attributed} from content` });
      else toastError("Sync failed", { message: r.error ?? "Check the store connection." });
    } catch (e) {
      toastError("Sync failed", { message: e instanceof Error ? e.message : "Try again." });
    } finally {
      setSyncing(false);
    }
  }

  async function exportCsv() {
    try {
      const csv = await exportStoreCsv(projectId, n);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `store-analytics-${days}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toastError("Export failed", { message: e instanceof Error ? e.message : "Try again." });
    }
  }

  if (isLoading) return <DashboardSkeleton />;

  if (isError || !data) {
    return (
      <Card className="flex flex-col items-center gap-2 p-12 text-center">
        <p className="text-sm font-medium text-foreground">Store data unavailable</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          The dashboard could not be loaded. Check the store connection, then try again.
        </p>
      </Card>
    );
  }

  const empty = data.kpis.orders.value === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Controls ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented value={days} onChange={setDays}
                   options={RANGES.map((r) => ({ key: r.key, label: r.label }))} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setCompare((v) => !v)}
            aria-pressed={compare}
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors",
              compare ? "border-foreground/20 bg-foreground/5 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            Compare
          </button>
          <button
            onClick={refresh}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {syncing || isFetching
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            {syncing ? "Syncing…" : "Sync"}
          </button>
          <button
            onClick={exportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      {empty ? (
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <p className="text-sm font-medium text-foreground">No orders in this period</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Sync the store, or widen the date range. Nothing below is hidden —
            there is simply nothing to show yet.
          </p>
        </Card>
      ) : (
        <>
          <AlertsBar data={data} />

          {/* ── Executive KPIs ── */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {KPI_ORDER.filter((k) => data.kpis[k]).map((k) => (
              <KpiCard key={k} label={KPI_LABELS[k] ?? k} kpi={data.kpis[k]}
                       fmt={fmt} invert={INVERTED.has(k)} />
            ))}
          </div>

          {/* ── Revenue analysis ── */}
          <Section
            title="Revenue over time"
            subtitle={`${data.range.start} to ${data.range.end}`}
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Segmented value={metric} onChange={setMetric} size="xs"
                           options={METRICS.map((m) => ({ key: m.key, label: m.label }))} />
                {metric === "revenue" && (
                  <>
                    <Toggle on={movingAverage} onClick={() => setMovingAverage((v) => !v)}>7-day avg</Toggle>
                    <Toggle on={showForecast} onClick={() => setShowForecast((v) => !v)}>Forecast</Toggle>
                  </>
                )}
              </div>
            }
          >
            <MainChart
              data={data.series} metric={metric} money={fmt.moneyShort}
              compare={compare} movingAverage={movingAverage}
              forecast={showForecast ? data.forecast.rows : undefined}
            />
          </Section>

          <InsightsPanel data={data} />

          {/* Content attribution sits high: it is the one thing here Shopify's
              own dashboard cannot tell the merchant. */}
          <ContentSection data={data} fmt={fmt} />

          <BreakdownSection data={data} fmt={fmt} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <FunnelSection data={data} fmt={fmt} />
            <GeoSection data={data} fmt={fmt} />
          </div>

          <ProductsSection data={data} fmt={fmt} />
          <CustomersSection data={data} fmt={fmt} />

          <MarketingSection data={data} fmt={fmt} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <LiveSection data={data} fmt={fmt} />
            <ForecastSection data={data} fmt={fmt} />
          </div>

          <OperationsSection data={data} fmt={fmt} />
        </>
      )}

      {/* Offered here, not assumed: a merchant reading store revenue is one
          connection away from knowing which search brought the buyer. */}
      {!gscConnected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Globe className="h-4 w-4 shrink-0" />
            Connect Search Console to see what people searched before they bought.
          </span>
          <button
            onClick={async () => { const r = await connectGsc(projectId); window.location.href = r.redirect_url; }}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Connect
          </button>
        </div>
      )}

      <p className="px-1 pb-2 text-[11px] leading-relaxed text-muted-foreground">
        Figures marked <span className="font-medium">Sample</span> are placeholders
        for sources not connected yet — line items, customer records, the Analytics
        API and ad platforms. Everything unmarked is measured from your synced orders.
      </p>
    </div>
  );
}

function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        on ? "border-foreground/20 bg-foreground/5 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-9 w-72 animate-pulse rounded-lg bg-muted/40" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-muted/30" />
        ))}
      </div>
      <div className="h-[380px] animate-pulse rounded-xl border border-border bg-muted/30" />
      <div className="h-64 animate-pulse rounded-xl border border-border bg-muted/30" />
    </div>
  );
}
