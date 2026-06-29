"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, BarChart2, MousePointerClick, Eye, TrendingUp, Crosshair } from "lucide-react";

const AnalyticsAreaChart = dynamic(
  () => import("./AnalyticsChart").then((m) => ({ default: m.AnalyticsAreaChart })),
  { ssr: false, loading: () => <div className="h-[220px] animate-pulse rounded-xl bg-muted/30" /> },
);
import { FennecMascot } from "@fennex/ui";
import {
  getAnalyticsOverview,
  getAnalyticsTraffic,
  getAnalyticsRankings,
  getTopPages,
  getTopQueries,
  getContentPerformance,
  getGscStatus,
  connectGsc,
  disconnectGsc,
  type AnalyticsRange,
  type RankingRow,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

// ─── DifficultyBar ───────────────────────────────────────────────────────────

function DifficultyBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">—</span>;
  const color = score <= 30 ? "#10b981" : score <= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs tabular-nums">{Math.round(score)}</span>
    </div>
  );
}

// ─── IntentBadge ─────────────────────────────────────────────────────────────

const INTENT_TONE: Record<string, BadgeTone> = {
  informational: "info",
  navigational: "primary",
  commercial: "warning",
  transactional: "success",
};

function IntentBadge({ intent }: { intent: string | null }) {
  if (!intent) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge tone={INTENT_TONE[intent] ?? "neutral"}>
      {intent.charAt(0).toUpperCase() + intent.slice(1)}
    </Badge>
  );
}

// ─── GscBanner ───────────────────────────────────────────────────────────────

function GscBanner({ projectId }: { projectId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { success: showSuccess, error: showError } = useToast();

  const { data: status, refetch } = useQuery({
    queryKey: ["analytics", "gsc-status", projectId],
    queryFn: () => getGscStatus(projectId),
    staleTime: 30_000,
  });

  // Handle redirect back from Google OAuth
  useEffect(() => {
    const connected = searchParams.get("gsc_connected");
    const gscError = searchParams.get("gsc_error");
    if (connected === "1") {
      refetch();
      queryClient.invalidateQueries({ queryKey: ["analytics", "gsc-status", projectId] });
      showSuccess("Search Console connected", { message: "Traffic data will sync shortly." });
      router.replace(`/${projectId}/analytics`, { scroll: false });
    } else if (gscError) {
      showError("Failed to connect Search Console", { message: gscError.replace(/_/g, " ") });
      router.replace(`/${projectId}/analytics`, { scroll: false });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleConnect() {
    const res = await connectGsc(projectId);
    window.location.href = res.redirect_url;
  }

  async function handleDisconnect() {
    await disconnectGsc(projectId);
    queryClient.invalidateQueries({ queryKey: ["analytics", "gsc-status", projectId] });
  }

  if (!status) {
    return <div className="h-10 rounded-lg border bg-muted/20 animate-pulse" />;
  }

  if (status.is_connected) {
    return (
      <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-4 py-2.5 text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          Search Console connected — <strong className="text-foreground">{status.google_email}</strong>
          {status.last_synced_at && (
            <> · Last synced {new Date(status.last_synced_at).toLocaleDateString()}</>
          )}
        </span>
        <button onClick={handleDisconnect} className="text-destructive hover:underline text-xs">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-dashed bg-muted/20 px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">
        Connect Google Search Console to sync real traffic data.
      </span>
      <button
        onClick={handleConnect}
        className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
      >
        Connect
      </button>
    </div>
  );
}

// ─── OverviewTab ─────────────────────────────────────────────────────────────

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/30" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-xl border bg-muted/30" />
    </div>
  );
}

function OverviewTab({ projectId, range }: { projectId: string; range: AnalyticsRange }) {
  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["analytics", "overview", projectId, range],
    queryFn: () => getAnalyticsOverview(projectId, range),
    staleTime: 5 * 60_000,
  });

  const { data: traffic = [], isLoading: trafficLoading } = useQuery({
    queryKey: ["analytics", "traffic", projectId, range],
    queryFn: () => getAnalyticsTraffic(projectId, range),
    staleTime: 5 * 60_000,
  });

  const chartData = traffic.map((d) => ({ ...d, date: fmtDate(d.date) }));

  if (overviewLoading || trafficLoading) {
    return <OverviewSkeleton />;
  }

  if (!overview) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <FennecMascot />
        <p>No analytics data yet. Run keyword research to populate rankings.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Clicks" tone="primary" icon={MousePointerClick}
          value={fmtNum(overview.clicks)} change={overview.clicks_change}
          spark={traffic.map((t) => t.clicks)}
        />
        <StatCard
          label="Impressions" tone="violet" icon={Eye}
          value={fmtNum(overview.impressions)} change={overview.impressions_change}
          spark={traffic.map((t) => t.impressions)}
        />
        <StatCard
          label="Avg CTR" tone="emerald" icon={TrendingUp}
          value={`${(overview.ctr * 100).toFixed(2)}%`} change={overview.ctr_change}
        />
        <StatCard
          label="Avg Position" tone="amber" icon={Crosshair}
          value={overview.avg_position.toFixed(1)} change={overview.position_change} invertChange
        />
      </div>

      <Card className="p-5">
        <p className="mb-4 text-sm font-medium text-muted-foreground">
          Clicks &amp; Impressions
        </p>
        <AnalyticsAreaChart data={chartData} />
      </Card>
    </div>
  );
}

// ─── RankingsTab ─────────────────────────────────────────────────────────────

function RankingsTab({ projectId }: { projectId: string }) {
  const [sortBy, setSortBy] = useState<"position" | "volume" | "change">("position");
  const [page, setPage] = useState(1);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["analytics", "rankings", projectId, sortBy, page],
    queryFn: () => getAnalyticsRankings(projectId, sortBy, page),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground text-sm">Loading rankings…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <FennecMascot />
        <p>No keyword rankings yet. Run keyword research first.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Sort by:</span>
        {(["position", "volume", "change"] as const).map((s) => (
          <button
            key={s}
            onClick={() => { setSortBy(s); setPage(1); }}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              sortBy === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Keyword</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Volume</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Intent</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Difficulty</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Position</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: RankingRow) => (
              <tr key={row.keyword_id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium">{row.keyword}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {row.search_volume?.toLocaleString() ?? "—"}
                </td>
                <td className="px-4 py-3">
                  <IntentBadge intent={row.intent} />
                </td>
                <td className="px-4 py-3">
                  <DifficultyBar score={row.difficulty} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">
                  {row.current_position?.toFixed(1) ?? "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {row.position_change === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : row.position_change < 0 ? (
                    <span className="text-success flex items-center justify-end gap-0.5">
                      <ArrowUp className="h-3 w-3" />
                      {Math.abs(row.position_change).toFixed(1)}
                    </span>
                  ) : row.position_change > 0 ? (
                    <span className="text-destructive flex items-center justify-end gap-0.5">
                      <ArrowDown className="h-3 w-3" />
                      {row.position_change.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <button
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
          className="disabled:opacity-40 hover:text-foreground"
        >
          ← Previous
        </button>
        <span>Page {page}</span>
        <button
          disabled={rows.length < 25}
          onClick={() => setPage((p) => p + 1)}
          className="disabled:opacity-40 hover:text-foreground"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

// ─── MetricsTable ────────────────────────────────────────────────────────────

function MetricsTable<T extends { clicks: number; impressions: number; ctr: number; avg_position: number }>({
  rows,
  labelKey,
  labelHeader,
}: {
  rows: T[];
  labelKey: keyof T;
  labelHeader: string;
}) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{labelHeader}</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Clicks</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Impressions</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">CTR</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Avg Pos</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-3 max-w-xs truncate text-muted-foreground font-mono text-xs">
                {String(row[labelKey])}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{row.clicks.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.impressions.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{(row.ctr * 100).toFixed(2)}%</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.avg_position.toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ─── PagesQueriesTab ─────────────────────────────────────────────────────────

function PagesQueriesTab({ projectId }: { projectId: string }) {
  const { data: pages = [] } = useQuery({
    queryKey: ["analytics", "top-pages", projectId],
    queryFn: () => getTopPages(projectId),
    staleTime: 5 * 60_000,
  });

  const { data: queries = [] } = useQuery({
    queryKey: ["analytics", "top-queries", projectId],
    queryFn: () => getTopQueries(projectId),
    staleTime: 5 * 60_000,
  });

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-3 text-sm font-medium">Top Pages</h3>
        {pages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No page data yet.</p>
        ) : (
          <MetricsTable rows={pages} labelKey="url" labelHeader="Page" />
        )}
      </div>
      <div>
        <h3 className="mb-3 text-sm font-medium">Top Queries</h3>
        {queries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No query data yet.</p>
        ) : (
          <MetricsTable rows={queries} labelKey="query" labelHeader="Query" />
        )}
      </div>
    </div>
  );
}

// ─── ContentPerformanceTab ────────────────────────────────────────────────────

function ContentPerformanceTab({ projectId }: { projectId: string }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["analytics", "content-performance", projectId],
    queryFn: () => getContentPerformance(projectId),
    staleTime: 5 * 60_000,
  });

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <FennecMascot />
        <p>Publish articles to see their performance here.</p>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Article</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Clicks</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Impressions</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">CTR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.article_id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
              <td className="px-4 py-3">
                <div className="font-medium">{row.title}</div>
                {!row.published_url ? (
                  <span className="text-xs text-muted-foreground">Not published</span>
                ) : (
                  <span className="text-xs text-muted-foreground font-mono truncate max-w-xs block">
                    {row.published_url}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-right tabular-nums">{row.clicks.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{row.impressions.toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums">{(row.ctr * 100).toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Tab = "overview" | "rankings" | "pages" | "content";

export default function AnalyticsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [range, setRange] = useState<AnalyticsRange>("28d");

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "rankings", label: "Rankings" },
    { key: "pages", label: "Pages & Queries" },
    { key: "content", label: "Content" },
  ];

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <PageHeader
        title="Analytics"
        icon={BarChart2}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Analytics" }]}
        description="Search performance, rankings, and content impact."
      />

      <GscBanner projectId={projectId} />

      <div className="flex flex-col gap-5 lg:flex-row">
        {/* Sticky filter rail */}
        <aside className="glass shrink-0 self-start p-3 lg:sticky lg:top-2 lg:w-52">
          <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Views</p>
          <nav className="flex flex-col gap-0.5">
            {tabs.map((t) => {
              const active = activeTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    "relative rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                    active ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                  )}
                >
                  {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />}
                  {t.label}
                </button>
              );
            })}
          </nav>

          {activeTab === "overview" && (
            <div className="mt-4 border-t border-white/[0.06] pt-3">
              <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Date range</p>
              <div className="flex gap-1">
                {(["7d", "28d", "90d"] as AnalyticsRange[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setRange(r)}
                    className={cn(
                      "flex-1 rounded-lg py-1.5 text-xs font-medium transition-colors",
                      range === r ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                    )}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {activeTab === "overview" && <OverviewTab projectId={projectId} range={range} />}
          {activeTab === "rankings" && <RankingsTab projectId={projectId} />}
          {activeTab === "pages" && <PagesQueriesTab projectId={projectId} />}
          {activeTab === "content" && <ContentPerformanceTab projectId={projectId} />}
        </div>
      </div>
    </div>
  );
}
