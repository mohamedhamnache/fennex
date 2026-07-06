"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ArrowDown, BarChart2, MousePointerClick, Eye, TrendingUp, Crosshair, RefreshCw, Globe, Check, Loader2, Target, Sparkles, ExternalLink, Send, Bot, Layers, Lightbulb, ShoppingBag, PenLine, Briefcase, Copy, Swords, X, Activity, Compass, Gauge, Mail, Palmtree, Download, FileText } from "lucide-react";

const AnalyticsAreaChart = dynamic(
  () => import("./AnalyticsChart").then((m) => ({ default: m.AnalyticsAreaChart })),
  { ssr: false, loading: () => <div className="h-[220px] animate-pulse rounded-xl bg-muted/30" /> },
);
const HorizontalBar = dynamic(
  () => import("./AnalyticsChart").then((m) => ({ default: m.HorizontalBar })),
  { ssr: false, loading: () => <div className="h-[260px] animate-pulse rounded-xl bg-muted/30" /> },
);
const AgentChart = dynamic(
  () => import("./AnalyticsChart").then((m) => ({ default: m.AgentChart })),
  { ssr: false, loading: () => <div className="h-[160px] animate-pulse rounded-lg bg-muted/30" /> },
);
const ClicksPositionChart = dynamic(
  () => import("./AnalyticsChart").then((m) => ({ default: m.ClicksPositionChart })),
  { ssr: false, loading: () => <div className="h-[240px] animate-pulse rounded-xl bg-muted/30" /> },
);
const TrafficCompareChart = dynamic(
  () => import("./AnalyticsChart").then((m) => ({ default: m.TrafficCompareChart })),
  { ssr: false, loading: () => <div className="h-[220px] animate-pulse rounded-xl bg-muted/30" /> },
);
const HealthGauge = dynamic(
  () => import("./AnalyticsChart").then((m) => ({ default: m.HealthGauge })),
  { ssr: false, loading: () => <div className="mx-auto h-[190px] w-[190px] animate-pulse rounded-full bg-muted/30" /> },
);
const DonutChart = dynamic(
  () => import("./AnalyticsChart").then((m) => ({ default: m.DonutChart })),
  { ssr: false, loading: () => <div className="h-[210px] animate-pulse rounded-xl bg-muted/30" /> },
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
  getGscSites,
  selectGscSite,
  syncGsc,
  getOpportunities,
  askAnalyticsAgent,
  getMarketInsights,
  analyzeCompetitorPage,
  getHealthScore,
  listProjects,
  sendDigestNow,
  generateMarketReport,
  trackRecommendation,
  type MarketReport,
  type CompetitorAnalysis,
  type AnalyticsRange,
  type RankingRow,
  type GscSite,
  type OpportunityRow,
  type AnalyticsChatTurn,
  type ContentIdea,
  type IdeaType,
  type AgentChartSpec,
} from "@/lib/api";
import { FENNEX_AGENTS } from "@/lib/agents";
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

/** Render an error string, turning any embedded URL into a clickable link. */
function ErrorWithLink({ text }: { text: string }) {
  const m = text.match(/https?:\/\/[^\s)]+/);
  if (!m) return <>{text}</>;
  const url = m[0];
  const [before, after] = text.split(url);
  return (
    <>
      {before}
      <a href={url} target="_blank" rel="noreferrer" className="font-medium underline hover:text-foreground">
        {url.replace(/^https?:\/\//, "").slice(0, 42)}…
      </a>
      {after}
    </>
  );
}

// ─── GscBanner ───────────────────────────────────────────────────────────────

function GscBanner({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
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

  const connected = !!status?.is_connected;
  const hasSite = !!status?.site_url;
  const [showPicker, setShowPicker] = useState(false);
  const [choice, setChoice] = useState<string>("");
  const [syncing, setSyncing] = useState(false);

  const pickerOpen = connected && (!hasSite || showPicker);

  const { data: sites = [], isLoading: sitesLoading, error: sitesError, refetch: refetchSites, isFetching: sitesFetching } = useQuery<GscSite[]>({
    queryKey: ["analytics", "gsc-sites", projectId],
    queryFn: () => getGscSites(projectId),
    enabled: pickerOpen,
    staleTime: 60_000,
    retry: false,
  });

  async function handleConnect() {
    const res = await connectGsc(projectId);
    window.location.href = res.redirect_url;
  }

  async function handleDisconnect() {
    await disconnectGsc(projectId);
    queryClient.invalidateQueries({ queryKey: ["analytics"] });
  }

  async function runSync() {
    setSyncing(true);
    try {
      const r = await syncGsc(projectId, 90);
      queryClient.invalidateQueries({ queryKey: ["analytics"] });
      await refetch();
      showSuccess("Search Console synced", {
        message: `${r.date_points} days · ${r.queries} queries · ${r.pages} pages · ${r.keywords_matched} keywords matched`,
      });
    } catch (e) {
      showError("Sync failed", { message: e instanceof Error ? e.message : "Try reconnecting Google." });
    } finally {
      setSyncing(false);
    }
  }

  async function handleSelectSite() {
    if (!choice) return;
    try {
      await selectGscSite(projectId, choice);
      setShowPicker(false);
      queryClient.invalidateQueries({ queryKey: ["analytics", "gsc-status", projectId] });
      await refetch();
      runSync(); // pull data immediately for the freshly-picked property
    } catch (e) {
      showError("Could not select site", { message: e instanceof Error ? e.message : "Try again." });
    }
  }

  if (!status) {
    return <div className="h-12 rounded-xl border bg-muted/20 animate-pulse" />;
  }

  // Not connected → connect CTA
  if (!connected) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-dashed bg-muted/20 px-4 py-3 text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <Globe className="h-4 w-4" /> {t("analytics.connectSearchConsole")}
        </span>
        <button
          onClick={handleConnect}
          className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {t("analytics.connect")}
        </button>
      </div>
    );
  }

  // Connected but choosing a property
  if (pickerOpen) {
    return (
      <div className="rounded-xl border bg-card px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Globe className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Choose a Search Console property</span>
          <span className="text-xs text-muted-foreground">— {status.google_email}</span>
        </div>
        {sitesLoading ? (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your properties…
          </div>
        ) : sitesError ? (
          <div className="py-2 text-xs text-destructive">
            <p className="leading-relaxed">
              <ErrorWithLink text={sitesError instanceof Error ? sitesError.message : "Could not load properties."} />
            </p>
            <div className="mt-2 flex items-center gap-3">
              <button
                onClick={() => refetchSites()}
                disabled={sitesFetching}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                {sitesFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Try again
              </button>
              <button onClick={handleConnect} className="text-[11px] text-muted-foreground hover:text-foreground underline">
                Reconnect Google
              </button>
            </div>
          </div>
        ) : sites.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">
            No properties found for this Google account. Add your site in Search Console first.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={choice}
              onChange={(e) => setChoice(e.target.value)}
              className="flex-1 min-w-[220px] rounded-lg border border-border bg-input px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            >
              <option value="" disabled>Select a property…</option>
              {sites.map((s) => (
                <option key={s.site_url} value={s.site_url}>
                  {s.site_url}{s.permission_level ? `  (${s.permission_level.replace("site", "")})` : ""}
                </option>
              ))}
            </select>
            <button
              onClick={handleSelectSite}
              disabled={!choice}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> Use this site
            </button>
            {hasSite && (
              <button onClick={() => setShowPicker(false)} className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Connected + site selected → status + sync
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-2.5 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground min-w-0">
        <span className="h-1.5 w-1.5 rounded-full bg-success shrink-0" />
        <Globe className="h-3.5 w-3.5 shrink-0" />
        <strong className="text-foreground truncate">{status.site_url}</strong>
        <button onClick={() => setShowPicker(true)} className="text-xs text-primary hover:underline shrink-0">
          change
        </button>
        {status.last_synced_at && (
          <span className="text-xs shrink-0">· synced {new Date(status.last_synced_at).toLocaleString()}</span>
        )}
      </span>
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={runSync}
          disabled={syncing}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <button onClick={handleDisconnect} className="text-destructive hover:underline text-xs">
          {t("analytics.disconnect")}
        </button>
      </div>
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
  const { t } = useTranslation();
  const [compare, setCompare] = useState(false);
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

  const { data: trafficPrev = [] } = useQuery({
    queryKey: ["analytics", "traffic", projectId, range, "prev"],
    queryFn: () => getAnalyticsTraffic(projectId, range, 1),
    enabled: compare,
    staleTime: 5 * 60_000,
  });

  const { data: health } = useQuery({
    queryKey: ["analytics", "health", projectId],
    queryFn: () => getHealthScore(projectId),
    staleTime: 5 * 60_000,
  });

  const chartData = traffic.map((d) => ({ ...d, date: fmtDate(d.date) }));
  // Align previous period by index so it overlays the current window
  const compareData = traffic.map((d, i) => ({
    date: fmtDate(d.date),
    clicks: d.clicks,
    clicksPrev: trafficPrev[i]?.clicks ?? null,
  }));

  if (overviewLoading || trafficLoading) {
    return <OverviewSkeleton />;
  }

  if (!overview) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <FennecMascot />
        <p>{t("analytics.noData")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Hero: health gauge + KPI grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[300px,1fr]">
        <Card className="flex flex-col items-center justify-center gap-3 p-5">
          <div className="flex w-full items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" strokeWidth={1.8} />
            <p className="text-sm font-semibold text-foreground">SEO health</p>
          </div>
          {health && health.has_data ? (
            <>
              <HealthGauge score={health.score} grade={health.grade} />
              <div className="flex w-full flex-col gap-1.5">
                {health.components.map((c) => (
                  <div key={c.key} title={c.detail} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 truncate text-[11px] text-muted-foreground">{c.label}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", c.score >= 65 ? "bg-success" : c.score >= 45 ? "bg-warning" : "bg-destructive")}
                        style={{ width: `${Math.max(4, c.score)}%` }}
                      />
                    </div>
                    <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-foreground">{c.score}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="py-10 text-center text-xs text-muted-foreground">Sync Search Console to compute your score.</p>
          )}
        </Card>

        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label={t("analytics.stats.clicks")} tone="primary" icon={MousePointerClick}
            value={fmtNum(overview.clicks)} change={overview.clicks_change}
            spark={traffic.map((tr) => tr.clicks)}
          />
          <StatCard
            label={t("analytics.stats.impressions")} tone="violet" icon={Eye}
            value={fmtNum(overview.impressions)} change={overview.impressions_change}
            spark={traffic.map((tr) => tr.impressions)}
          />
          <StatCard
            label={t("analytics.stats.avgCtr")} tone="emerald" icon={TrendingUp}
            value={`${(overview.ctr * 100).toFixed(2)}%`} change={overview.ctr_change}
          />
          <StatCard
            label={t("analytics.stats.avgPosition")} tone="amber" icon={Crosshair}
            value={overview.avg_position.toFixed(1)} change={overview.position_change} invertChange
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              {compare ? "Clicks vs. previous period" : t("analytics.stats.clicksImpressions")}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCompare((v) => !v)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors",
                  compare ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                Compare
              </button>
              <LivePill />
            </div>
          </div>
          {compare ? <TrafficCompareChart data={compareData} /> : <AnalyticsAreaChart data={chartData} />}
        </Card>
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">Clicks vs. average position</p>
            <span className="text-[11px] text-muted-foreground">lower position = better</span>
          </div>
          <ClicksPositionChart data={chartData} />
        </Card>
      </div>
    </div>
  );
}

// ─── RankingsTab ─────────────────────────────────────────────────────────────

function RankingsTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [sortBy, setSortBy] = useState<"position" | "clicks" | "volume" | "change">("clicks");
  const [page, setPage] = useState(1);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["analytics", "rankings", projectId, sortBy, page],
    queryFn: () => getAnalyticsRankings(projectId, sortBy, page),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground text-sm">{t("analytics.loadingRankings")}</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <FennecMascot />
        <p>{t("analytics.noRankings")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("analytics.sortBy")}</span>
        {(["clicks", "position", "volume", "change"] as const).map((s) => (
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
        <span className="ml-auto"><LivePill /></span>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.keyword")}</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Clicks</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Impr.</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.volume")}</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.intent")}</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.difficulty")}</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.position")}</th>
              <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.change")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row: RankingRow) => (
              <tr key={row.keyword_id ?? row.keyword} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-3 font-medium">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate max-w-[260px]">{row.keyword}</span>
                    {row.tracked && (
                      <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary" title="Tracked keyword from your research">
                        tracked
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">{row.clicks.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{row.impressions.toLocaleString()}</td>
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
          {t("common.previousPage")}
        </button>
        <span>{t("common.page", { n: page })}</span>
        <button
          disabled={rows.length < 25}
          onClick={() => setPage((p) => p + 1)}
          className="disabled:opacity-40 hover:text-foreground"
        >
          {t("common.nextPage")}
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
  const { t } = useTranslation();
  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{labelHeader}</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.clicks")}</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.impressions")}</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.ctr")}</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.avgPos")}</th>
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

function LivePill() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" /> Live from Search Console
    </span>
  );
}

function DataPanel<T extends { clicks: number; impressions: number; ctr: number; avg_position: number }>({
  title, rows, labelKey, labelHeader, emptyText,
}: { title: string; rows: T[]; labelKey: keyof T; labelHeader: string; emptyText: string }) {
  const chartData = rows.slice(0, 10).map((r) => ({ label: String(r[labelKey]), clicks: r.clicks }));
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <LivePill />
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <>
          <div className="px-2 pt-3">
            <HorizontalBar data={chartData} labelKey="label" valueKey="clicks" height={Math.max(160, chartData.length * 26 + 20)} />
          </div>
          <div className="max-h-72 overflow-y-auto border-t">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-card">
                <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">{labelHeader}</th>
                  <th className="text-right px-3 py-2 font-medium">Clicks</th>
                  <th className="text-right px-3 py-2 font-medium">Impr.</th>
                  <th className="text-right px-3 py-2 font-medium">CTR</th>
                  <th className="text-right px-4 py-2 font-medium">Pos</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2 max-w-[220px] truncate text-xs text-foreground">{String(row[labelKey]).replace(/^https?:\/\/[^/]+/, "") || String(row[labelKey])}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{row.clicks.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{row.impressions.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{(row.ctr * 100).toFixed(1)}%</td>
                    <td className="px-4 py-2 text-right tabular-nums">{row.avg_position.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function PagesQueriesTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
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
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <DataPanel title={t("analytics.topPages")} rows={pages} labelKey="url" labelHeader={t("analytics.tableHeaders.page")} emptyText={t("analytics.noPageData")} />
      <DataPanel title={t("analytics.topQueries")} rows={queries} labelKey="query" labelHeader={t("analytics.tableHeaders.query")} emptyText={t("analytics.noQueryData")} />
    </div>
  );
}

// ─── ContentPerformanceTab ────────────────────────────────────────────────────

function ContentPerformanceTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data: rows = [] } = useQuery({
    queryKey: ["analytics", "content-performance", projectId],
    queryFn: () => getContentPerformance(projectId),
    staleTime: 5 * 60_000,
  });

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
        <FennecMascot />
        <p>{t("analytics.publishArticles")}</p>
      </div>
    );
  }

  return (
    <Card className="overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.article")}</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.clicks")}</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.impressions")}</th>
            <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">{t("analytics.tableHeaders.ctr")}</th>
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

// ─── OpportunitiesTab ────────────────────────────────────────────────────────

function OppTable({ rows, target, projectId }: { rows: OpportunityRow[]; target: string; projectId: string }) {
  const { success: showSuccess, error: showError } = useToast();
  const [tracked, setTracked] = useState<Record<string, boolean>>({});

  async function track(r: OpportunityRow) {
    try {
      await trackRecommendation(projectId, {
        source: "opportunity",
        source_agent: "zerda",
        kind: r.kind,
        title: `Target "${r.query}"`,
        anchor_query: r.query,
        anchor_url: r.url ?? undefined,
      });
      setTracked((t) => ({ ...t, [r.query]: true }));
      showSuccess("Tracking", { message: "Zerda will report back once you act on it." });
    } catch {
      showError("Could not track", { message: "Please try again." });
    }
  }

  if (rows.length === 0) {
    return <p className="px-4 py-6 text-center text-xs text-muted-foreground">No opportunities in this bucket yet — sync more data.</p>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="border-b bg-muted/40">
        <tr>
          <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Query</th>
          <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Pos</th>
          <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Impr.</th>
          <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">CTR</th>
          <th className="text-right px-4 py-2.5 font-medium text-primary">{target}</th>
          <th className="px-4 py-2.5" />
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
            <td className="px-4 py-3 max-w-[280px]">
              <div className="font-medium truncate">{r.query}</div>
              {r.url && (
                <a href={r.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary truncate">
                  <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                  <span className="truncate">{r.url.replace(/^https?:\/\/[^/]+/, "")}</span>
                </a>
              )}
            </td>
            <td className="px-4 py-3 text-right tabular-nums font-medium">{r.position.toFixed(1)}</td>
            <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{r.impressions.toLocaleString()}</td>
            <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{(r.ctr * 100).toFixed(1)}%</td>
            <td className="px-4 py-3 text-right">
              <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-xs font-semibold text-success tabular-nums">
                +{r.potential_clicks.toLocaleString()}
              </span>
            </td>
            <td className="px-4 py-3 text-right">
              <button
                onClick={() => track(r)}
                disabled={tracked[r.query]}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                {tracked[r.query] ? "Tracking" : "Track"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OpportunitiesTab({ projectId }: { projectId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "opportunities", projectId],
    queryFn: () => getOpportunities(projectId),
    staleTime: 5 * 60_000,
  });

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-xl border bg-muted/30" />;
  }
  const empty = !data || (data.striking_distance.length === 0 && data.ctr_wins.length === 0);
  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
        <FennecMascot />
        <p>No opportunities yet.</p>
        <p className="text-xs max-w-sm">Connect Search Console and run a sync — we&apos;ll surface near-page-1 keywords and CTR quick wins from your real data.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Headline potential */}
      <Card className="flex items-center gap-4 p-5 bg-gradient-to-br from-primary/8 to-transparent">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Sparkles className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <p className="text-2xl font-bold text-foreground tabular-nums">+{data.total_potential_clicks.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">estimated extra clicks available across {data.striking_distance.length + data.ctr_wins.length} opportunities</p>
        </div>
      </Card>

      {/* Striking distance */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" strokeWidth={1.8} />
          <h3 className="text-sm font-semibold text-foreground">Striking distance</h3>
          <span className="text-xs text-muted-foreground">— ranking 4–20, push these onto page 1</span>
        </div>
        {data.striking_distance.length > 0 && (
          <Card className="mb-2 p-4">
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Top opportunities by potential clicks</p>
            <HorizontalBar
              data={data.striking_distance.slice(0, 8).map((o) => ({ label: o.query, potential: o.potential_clicks }))}
              labelKey="label"
              valueKey="potential"
              height={Math.max(140, Math.min(8, data.striking_distance.length) * 26 + 20)}
            />
          </Card>
        )}
        <Card className="overflow-hidden overflow-x-auto">
          <OppTable rows={data.striking_distance} target="Potential" projectId={projectId} />
        </Card>
      </div>

      {/* CTR wins */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <MousePointerClick className="h-4 w-4 text-primary" strokeWidth={1.8} />
          <h3 className="text-sm font-semibold text-foreground">CTR quick wins</h3>
          <span className="text-xs text-muted-foreground">— page 1 but low CTR, improve the title &amp; meta</span>
        </div>
        <Card className="overflow-hidden overflow-x-auto">
          <OppTable rows={data.ctr_wins} target="Potential" projectId={projectId} />
        </Card>
      </div>
    </div>
  );
}

// ─── Market tab ──────────────────────────────────────────────────────────────

const IDEA_TONE: Record<IdeaType, { tone: BadgeTone; label: string }> = {
  question: { tone: "info", label: "Question" },
  "how-to": { tone: "primary", label: "How-to" },
  comparison: { tone: "warning", label: "Comparison" },
  commercial: { tone: "success", label: "Commercial" },
  list: { tone: "primary", label: "List" },
  informational: { tone: "neutral", label: "Info" },
};

type Persona = "creator" | "ecommerce" | "freelancer";

const PERSONAS: { id: Persona; label: string; Icon: typeof PenLine; blurb: string; types: IdeaType[] }[] = [
  { id: "creator", label: "Creator", Icon: PenLine, blurb: "Content & video ideas with real search demand you can capture.", types: ["question", "how-to", "list", "informational", "comparison"] },
  { id: "ecommerce", label: "Ecommerce", Icon: ShoppingBag, blurb: "Buyer-intent queries and comparisons — product pages worth building.", types: ["commercial", "comparison", "list"] },
  { id: "freelancer", label: "Freelancer", Icon: Briefcase, blurb: "Map the niche: which topics drive demand, sized for a client report.", types: ["question", "how-to", "list", "commercial", "comparison", "informational"] },
];

/** Minimal markdown renderer for Oasis reports (headings, lists, paragraphs, bold). */
function ReportMarkdown({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = (key: string) => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={key} className="my-2 flex flex-col gap-1 pl-1">
        {list.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-foreground/90">
            <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
            <span>{renderInline(item)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  const renderInline = (text: string) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) =>
      p.startsWith("**") && p.endsWith("**") ? <strong key={i} className="font-semibold text-foreground">{p.slice(2, -2)}</strong> : p,
    );
  };
  markdown.split("\n").forEach((line, idx) => {
    const l = line.trim();
    if (l.startsWith("- ") || l.startsWith("* ")) {
      list.push(l.slice(2));
      return;
    }
    flush(`ul-${idx}`);
    if (l.startsWith("### ")) blocks.push(<h4 key={idx} className="mt-4 text-sm font-semibold text-foreground">{l.slice(4)}</h4>);
    else if (l.startsWith("## ")) blocks.push(<h3 key={idx} className="mt-5 border-b border-border pb-1.5 text-base font-bold text-foreground">{l.slice(3)}</h3>);
    else if (l.startsWith("# ")) blocks.push(<h2 key={idx} className="text-lg font-bold text-foreground">{l.slice(2)}</h2>);
    else if (l.length > 0) blocks.push(<p key={idx} className="mt-2 text-sm leading-relaxed text-foreground/90">{renderInline(l)}</p>);
  });
  flush("ul-end");
  return <div className="flex flex-col">{blocks}</div>;
}

function OasisReportCard({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<MarketReport | null>(null);
  const [generating, setGenerating] = useState(false);
  const { success: showSuccess, error: showError } = useToast();

  async function generate() {
    setGenerating(true);
    try {
      const res = await generateMarketReport(projectId);
      if (res.ok && res.markdown) {
        setReport(res);
        showSuccess("Report ready", { message: "Oasis finished your market report." });
      } else {
        showError("Report failed", { message: res.error ?? "Please try again." });
      }
    } catch {
      showError("Report failed", { message: "Could not reach the server." });
    } finally {
      setGenerating(false);
    }
  }

  function copyMarkdown() {
    if (!report?.markdown) return;
    navigator.clipboard.writeText(report.markdown);
    showSuccess("Copied", { message: "Markdown copied to clipboard." });
  }

  function downloadMarkdown() {
    if (!report?.markdown) return;
    const blob = new Blob([report.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(report.title ?? "market-report").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Palmtree className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">Oasis · Market Researcher</p>
          <p className="text-xs text-muted-foreground">A complete, client-ready market report written from your real search data.</p>
        </div>
        {report?.markdown ? (
          <div className="flex items-center gap-2">
            <button onClick={copyMarkdown} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors">
              <Copy className="h-3.5 w-3.5" /> Copy
            </button>
            <button onClick={downloadMarkdown} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors">
              <Download className="h-3.5 w-3.5" /> Download .md
            </button>
            <button onClick={generate} disabled={generating} className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50">
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Regenerate
            </button>
          </div>
        ) : (
          <button onClick={generate} disabled={generating} className="flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60">
            {generating ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Oasis is researching...
              </>
            ) : (
              <>
                <FileText className="h-3.5 w-3.5" /> Generate report
              </>
            )}
          </button>
        )}
      </div>

      {report?.markdown && (
        <div className="mt-4 rounded-xl border border-border bg-muted/20 p-5">
          <ReportMarkdown markdown={report.markdown} />
          {report.generated_at && (
            <p className="mt-5 border-t border-border pt-3 text-[11px] text-muted-foreground">
              Generated by Oasis on {report.generated_at} from your Search Console data.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function MarketTab({ projectId, persona }: { projectId: string; persona: Persona }) {
  const { data, isLoading } = useQuery({
    queryKey: ["analytics", "market", projectId],
    queryFn: () => getMarketInsights(projectId),
    staleTime: 5 * 60_000,
  });
  const { success: showSuccess } = useToast();

  if (isLoading) return <div className="h-64 animate-pulse rounded-xl border bg-muted/30" />;

  const empty = !data || (data.clusters.length === 0 && data.ideas.length === 0);
  if (empty) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center text-muted-foreground">
        <FennecMascot />
        <p>No market data yet.</p>
        <p className="text-xs max-w-sm">Sync Search Console — we&apos;ll cluster your real queries into topics and surface content ideas with genuine search demand.</p>
      </div>
    );
  }

  const cfg = PERSONAS.find((p) => p.id === persona)!;
  const ideas = data.ideas.filter((i) => cfg.types.includes(i.idea_type));
  const maxClicks = Math.max(1, ...data.clusters.map((c) => c.clicks), ...data.clusters.map((c) => Math.round(c.impressions / 20)));

  function copyReport() {
    const lines = [
      `Market snapshot — ${data!.total_clicks.toLocaleString()} clicks / ${data!.total_impressions.toLocaleString()} impressions`,
      "",
      "Top topics:",
      ...data!.clusters.slice(0, 8).map((c) => `- ${c.topic}: ${c.query_count} queries, ${c.clicks} clicks, avg pos ${c.avg_position}`),
      "",
      "Content opportunities:",
      ...ideas.slice(0, 15).map((i) => `- [${IDEA_TONE[i.idea_type].label}] ${i.query} (${i.impressions.toLocaleString()} impr, pos ${i.position})`),
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    showSuccess("Report copied", { message: "Paste it into your client doc." });
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Persona context strip */}
      <div className="flex flex-wrap items-center gap-2">
        <cfg.Icon className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <span className="text-xs text-muted-foreground">{cfg.blurb}</span>
        {persona === "freelancer" && (
          <button onClick={copyReport} className="ml-auto flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors">
            <Copy className="h-3.5 w-3.5" /> Copy report
          </button>
        )}
      </div>

      {/* Oasis market report */}
      <OasisReportCard projectId={projectId} />

      {/* Market snapshot for freelancer */}
      {persona === "freelancer" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Card className="p-4"><p className="text-xs text-muted-foreground">Total clicks</p><p className="text-xl font-bold tabular-nums">{fmtNum(data.total_clicks)}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Total impressions</p><p className="text-xl font-bold tabular-nums">{fmtNum(data.total_impressions)}</p></Card>
          <Card className="p-4"><p className="text-xs text-muted-foreground">Topics mapped</p><p className="text-xl font-bold tabular-nums">{data.clusters.length}</p></Card>
        </div>
      )}

      {/* Demand mix by content type */}
      {(() => {
        const dist = (["question", "how-to", "list", "comparison", "commercial", "informational"] as IdeaType[])
          .map((tp) => ({ name: IDEA_TONE[tp].label, value: data.ideas.filter((i) => i.idea_type === tp).length }))
          .filter((d) => d.value > 0);
        if (dist.length === 0) return null;
        return (
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-primary" strokeWidth={1.8} />
              <h3 className="text-sm font-semibold text-foreground">Demand mix</h3>
              <span className="text-xs text-muted-foreground">— your search demand by content type</span>
            </div>
            <Card className="p-4">
              <DonutChart data={dist} height={210} />
            </Card>
          </div>
        );
      })()}

      {/* Topic clusters */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" strokeWidth={1.8} />
          <h3 className="text-sm font-semibold text-foreground">Topic clusters</h3>
          <span className="text-xs text-muted-foreground">— your themes, ranked by traffic</span>
        </div>
        <Card className="divide-y">
          {data.clusters.map((c) => (
            <div key={c.topic} className="flex items-center gap-3 px-4 py-2.5">
              <div className="w-28 shrink-0">
                <p className="text-sm font-medium text-foreground capitalize truncate">{c.topic}</p>
                <p className="text-[11px] text-muted-foreground">{c.query_count} queries · pos {c.avg_position}</p>
              </div>
              <div className="flex-1 min-w-0">
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, (c.clicks / maxClicks) * 100)}%` }} />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground truncate">top: &ldquo;{c.top_query}&rdquo;</p>
              </div>
              <div className="w-20 shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums">{fmtNum(c.clicks)}</p>
                <p className="text-[11px] text-muted-foreground tabular-nums">{fmtNum(c.impressions)} impr</p>
              </div>
            </div>
          ))}
          {data.clusters.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted-foreground">Not enough queries to cluster yet.</p>}
        </Card>
      </div>

      {/* Content ideas */}
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" strokeWidth={1.8} />
          <h3 className="text-sm font-semibold text-foreground">Content ideas</h3>
          <span className="text-xs text-muted-foreground">— real demand, prioritised by unmet impressions</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {ideas.map((i: ContentIdea, idx) => (
            <div key={idx} className="flex items-start justify-between gap-2 rounded-xl border px-3 py-2.5 hover:border-primary/40 transition-colors">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{i.query}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge tone={IDEA_TONE[i.idea_type].tone}>{IDEA_TONE[i.idea_type].label}</Badge>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{fmtNum(i.impressions)} impr · pos {i.position}</span>
                </div>
              </div>
            </div>
          ))}
          {ideas.length === 0 && <p className="col-span-full px-4 py-6 text-center text-xs text-muted-foreground">No {persona} ideas in this data yet.</p>}
        </div>
      </div>
    </div>
  );
}

// ─── SEO Copilot (persona-aware side panel) ──────────────────────────────────

const COPILOT_STARTERS: Record<Persona, string[]> = {
  creator: [
    "What topics should my next posts cover?",
    "Which content formats does my audience search for?",
    "Why did my clicks change this period?",
    "Which posts are decaying and need a refresh?",
  ],
  ecommerce: [
    "Which buyer-intent queries should I target?",
    "Which pages need better titles to sell more?",
    "Where is my untapped revenue in search?",
    "What comparisons are shoppers searching for?",
  ],
  freelancer: [
    "Size the market opportunity in this niche",
    "What services does this demand suggest?",
    "Summarize this market for a client report",
    "Where can I win visibility fastest?",
  ],
};

const PERSONA_TITLES: Record<Persona, string> = {
  creator: "Content strategist mode",
  ecommerce: "Ecommerce SEO mode",
  freelancer: "Market analyst mode",
};

type AgentMessage = { role: "user" | "assistant"; content: string; chart?: AgentChartSpec | null; followups?: string[] };

function CopilotPanel({ projectId, persona, onClose }: { projectId: string; persona: Persona; onClose: () => void }) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [trackedMsg, setTrackedMsg] = useState<Record<number, boolean>>({});
  const { success: showSuccess } = useToast();
  const endRef = useRef<HTMLDivElement>(null);

  async function trackMessage(idx: number, content: string) {
    const title = content.length > 90 ? content.slice(0, 87) + "..." : content;
    await trackRecommendation(projectId, { source: "agent", source_agent: "zerda", title, detail: content });
    setTrackedMsg((t) => ({ ...t, [idx]: true }));
    showSuccess("Tracking", { message: "Added to Zerda's tracked recommendations." });
  }
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    const history: AnalyticsChatTurn[] = messages.slice(-4).map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: "user", content: q }]);
    setBusy(true);
    try {
      const res = await askAnalyticsAgent(projectId, q, history, persona);
      setMessages((prev) => [...prev, { role: "assistant", content: res.answer, chart: res.chart, followups: res.followups }]);
    } catch (e) {
      setMessages((prev) => [...prev, { role: "assistant", content: `Sorry — ${e instanceof Error ? e.message : "something went wrong"}.` }]);
    } finally {
      setBusy(false);
    }
  }

  const hasChat = messages.length > 0;

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b px-4 py-3 bg-gradient-to-r from-primary/8 to-transparent">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary/80 to-primary shadow-sm">
          <Sparkles className="h-4 w-4 text-white" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground leading-tight">{FENNEX_AGENTS.zerda.name} · {FENNEX_AGENTS.zerda.role}</p>
          <p className="text-[11px] text-muted-foreground leading-tight truncate">{PERSONA_TITLES[persona]} · grounded in your real data</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          title="Close Copilot"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Conversation */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {!hasChat && !busy && (
          <div className="animate-fade-in flex flex-col gap-3 pt-2">
            <p className="text-xs text-muted-foreground px-1">Start with a question:</p>
            <div className="grid grid-cols-1 gap-2">
              {COPILOT_STARTERS[persona].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="group flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary/60 group-hover:text-primary transition-colors" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={cn("flex gap-2.5", m.role === "user" ? "flex-row-reverse" : "flex-row")}>
            <div className={cn(
              "h-7 w-7 rounded-full flex items-center justify-center shrink-0 shadow-sm",
              m.role === "user" ? "bg-muted" : "bg-gradient-to-br from-primary/80 to-primary",
            )}>
              {m.role === "user" ? <span className="text-[10px] font-semibold text-muted-foreground">You</span> : <Bot className="h-3.5 w-3.5 text-white" />}
            </div>
            <div className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start", "max-w-[88%]")}>
              <div className={cn(
                "rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap",
                m.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm" : "bg-muted text-foreground rounded-bl-sm",
              )}>
                {m.content}
              </div>
              {m.chart && m.chart.data.length > 0 && (
                <div className="w-full min-w-[260px] rounded-xl border border-border bg-card p-3">
                  <AgentChart spec={m.chart} />
                </div>
              )}
              {/* Follow-up suggestions on the latest assistant reply */}
              {m.role === "assistant" && i === messages.length - 1 && !busy && (m.followups?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.followups!.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => ask(f)}
                      className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-[11px] text-primary hover:bg-primary/10 transition-colors"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}
              {m.role === "assistant" && (
                <button
                  type="button"
                  onClick={() => trackMessage(i, m.content)}
                  disabled={trackedMsg[i]}
                  className="self-start rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {trackedMsg[i] ? "Tracking this" : "Track this recommendation"}
                </button>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex gap-2.5">
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center shrink-0 shadow-sm">
              <Bot className="h-3.5 w-3.5 text-white" />
            </div>
            <div className="rounded-2xl rounded-bl-sm bg-muted px-4 py-3 flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="border-t p-3">
        <div className="flex items-end gap-2 rounded-xl border bg-input focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-all overflow-hidden">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input); } }}
            placeholder="Ask about your traffic, rankings, opportunities…"
            rows={2}
            className="flex-1 resize-none bg-transparent px-3 py-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            type="button"
            disabled={!input.trim() || busy}
            onClick={() => ask(input)}
            className="m-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 shrink-0"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
}

// ─── Competitors tab ─────────────────────────────────────────────────────────

const CHECK_LABELS: Record<string, string> = {
  title_ok: "Title length",
  meta_ok: "Meta description",
  single_h1: "Single H1",
  has_h2: "H2 structure",
  depth_ok: "Depth (600+ words)",
  has_schema: "Schema markup",
  alt_ok: "Image alt text",
  internal_links_ok: "Internal links",
  canonical_ok: "Canonical tag",
  viewport_ok: "Mobile viewport",
};

function CompetitorsTab({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompetitorAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    let u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await analyzeCompetitorPage(projectId, u);
      if (!res.ok) setError(res.error ?? "Analysis failed.");
      else setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  const card = result?.scorecard;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="mb-2 flex items-center gap-2">
          <Swords className="h-4 w-4 text-primary" strokeWidth={1.8} />
          <h3 className="text-sm font-semibold text-foreground">{FENNEX_AGENTS.sable.name} · {FENNEX_AGENTS.sable.role}</h3>
          <span className="text-xs text-muted-foreground">— crawls a rival page and compares it to your demand</span>
        </div>
        <div className="flex items-center gap-2 rounded-xl border bg-input focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15 transition-all overflow-hidden">
          <Globe className="ml-3 h-4 w-4 text-muted-foreground shrink-0" />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            placeholder="competitor.com/their-best-article"
            className="flex-1 bg-transparent py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            onClick={run}
            disabled={loading || !url.trim()}
            className="m-1.5 flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Swords className="h-3.5 w-3.5" />}
            {loading ? "Analyzing…" : "Analyze"}
          </button>
        </div>
        {error && <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive"><X className="h-3.5 w-3.5" /> {error}</p>}
      </div>

      {loading && <div className="h-40 animate-pulse rounded-xl border bg-muted/30" />}

      {card && (
        <div className="flex flex-col gap-5 animate-fade-in">
          {/* Score + key facts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="flex items-center gap-4 p-5">
              <div className={cn(
                "flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold tabular-nums",
                card.score >= 70 ? "bg-success/12 text-success" : card.score >= 40 ? "bg-warning/12 text-warning" : "bg-destructive/12 text-destructive",
              )}>
                {card.score}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">On-page SEO score</p>
                <a href={result!.url ?? url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary truncate">
                  <span className="truncate">{(result!.url ?? url).replace(/^https?:\/\//, "")}</span>
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </div>
            </Card>
            <Card className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
              {[
                { l: "Words", v: card.word_count.toLocaleString() },
                { l: "Title", v: `${card.title_length} ch` },
                { l: "Meta", v: `${card.meta_length} ch` },
                { l: "H2s", v: card.h2_count },
                { l: "Schema", v: card.schema_types.length || "—" },
                { l: "Int. links", v: card.internal_links },
                { l: "No-alt imgs", v: card.images_without_alt },
                { l: "Canonical", v: card.canonical ? "yes" : "no" },
              ].map((f) => (
                <div key={f.l}>
                  <p className="text-[11px] text-muted-foreground">{f.l}</p>
                  <p className="text-sm font-semibold tabular-nums">{f.v}</p>
                </div>
              ))}
            </Card>
          </div>

          {/* Checks */}
          <Card className="p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">On-page checks</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {Object.entries(card.checks).map(([k, ok]) => (
                <div key={k} className={cn("flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px]", ok ? "bg-success/8 text-success" : "bg-destructive/8 text-destructive")}>
                  {ok ? <Check className="h-3 w-3 shrink-0" /> : <X className="h-3 w-3 shrink-0" />}
                  <span className="truncate">{CHECK_LABELS[k] ?? k}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* AI gap insights */}
          {result!.insights && (
            <Card className="p-5 bg-gradient-to-br from-primary/5 to-transparent">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" strokeWidth={1.8} />
                <p className="text-sm font-semibold text-foreground">Content gaps &amp; what to create</p>
              </div>
              <p className="text-xs leading-relaxed text-foreground whitespace-pre-wrap">{result!.insights}</p>
            </Card>
          )}

          {/* Their outline */}
          {result!.outline.length > 0 && (
            <Card className="p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Their H2 outline</p>
              <div className="flex flex-wrap gap-1.5">
                {result!.outline.map((h, i) => (
                  <span key={i} className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">{h}</span>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {!card && !loading && !error && (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
          <Swords className="h-7 w-7 opacity-40" />
          <p className="text-xs max-w-sm">Paste a competitor&apos;s page URL. We&apos;ll crawl it, score its on-page SEO, and (with your real search demand) tell you the gaps worth filling.</p>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

// ─── Performance workspace (rankings · pages · content merged) ───────────────

function PerformanceTab({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [sub, setSub] = useState<"rankings" | "pages" | "content">("rankings");
  const subs = [
    { key: "rankings" as const, label: t("analytics.tabs.rankings") },
    { key: "pages" as const, label: t("analytics.tabs.pagesQueries") },
    { key: "content" as const, label: t("analytics.tabs.content") },
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5">
        {subs.map((s) => (
          <button
            key={s.key}
            onClick={() => setSub(s.key)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              sub === s.key ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
      {sub === "rankings" && <RankingsTab projectId={projectId} />}
      {sub === "pages" && <PagesQueriesTab projectId={projectId} />}
      {sub === "content" && <ContentPerformanceTab projectId={projectId} />}
    </div>
  );
}

// ─── Analytics Studio shell ───────────────────────────────────────────────────

type Workspace = "pulse" | "growth" | "market" | "competitors" | "performance";

const WORKSPACES: { key: Workspace; label: string; Icon: typeof Activity }[] = [
  { key: "pulse", label: "Pulse", Icon: Activity },
  { key: "growth", label: "Growth", Icon: Target },
  { key: "market", label: "Market", Icon: Compass },
  { key: "competitors", label: "Competitors", Icon: Swords },
  { key: "performance", label: "Performance", Icon: BarChart2 },
];

export default function AnalyticsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const searchParams = useSearchParams();
  const wsParam = searchParams.get("ws") as Workspace | null;
  const [workspace, setWorkspace] = useState<Workspace>(
    wsParam && WORKSPACES.some((w) => w.key === wsParam) ? wsParam : "pulse",
  );
  const [range, setRange] = useState<AnalyticsRange>("28d");
  const [persona, setPersona] = useState<Persona>("creator");
  const [copilotOpen, setCopilotOpen] = useState(searchParams.get("copilot") === "1");
  const [digestSending, setDigestSending] = useState(false);
  const { success: toastSuccess, error: toastError } = useToast();

  async function emailDigest() {
    if (digestSending) return;
    setDigestSending(true);
    try {
      const r = await sendDigestNow(projectId);
      if (r.ok) toastSuccess("Digest sent", { message: `${r.sent} email(s): ${r.subject ?? ""}` });
      else toastError("Digest not sent", { message: r.error ?? "Unknown error" });
    } catch (e) {
      toastError("Digest failed", { message: e instanceof Error ? e.message : "Try again." });
    } finally {
      setDigestSending(false);
    }
  }

  // Project persona (set during onboarding) seeds the studio persona
  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: listProjects, staleTime: 60_000 });
  const projectPersona = projects.find((p) => p.id === projectId)?.persona;

  // Persist the persona choice — it shapes Market and the Copilot everywhere.
  // Priority: explicit user choice (localStorage) > project onboarding persona.
  useEffect(() => {
    const saved = localStorage.getItem("fx-analytics-persona");
    if (saved === "creator" || saved === "ecommerce" || saved === "freelancer") setPersona(saved);
    else if (projectPersona) setPersona(projectPersona);
  }, [projectPersona]);
  function changePersona(p: Persona) {
    setPersona(p);
    localStorage.setItem("fx-analytics-persona", p);
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* ── Command bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <BarChart2 className="h-5 w-5" strokeWidth={1.9} />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground leading-tight">Analytics Studio</h1>
            <p className="text-xs text-muted-foreground leading-tight">Real Search Console data · market intelligence · AI copilot</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Persona switcher */}
          <div className="flex items-center gap-0.5 rounded-xl border border-border bg-muted/40 p-0.5">
            {PERSONAS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => changePersona(id)}
                title={label}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  persona === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                <span className="hidden sm:inline">{label}</span>
              </button>
            ))}
          </div>

          {/* Date range */}
          <div className="flex items-center gap-0.5 rounded-xl border border-border bg-muted/40 p-0.5">
            {(["7d", "28d", "90d"] as AnalyticsRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  range === r ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {r}
              </button>
            ))}
          </div>

          {/* Weekly digest */}
          <button
            onClick={emailDigest}
            disabled={digestSending}
            title="Email this week's digest to your team now"
            className="flex items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {digestSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Digest</span>
          </button>

          {/* Copilot toggle */}
          <button
            onClick={() => setCopilotOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all",
              copilotOpen
                ? "bg-primary text-primary-foreground shadow-md"
                : "border border-primary/40 bg-primary/5 text-primary hover:bg-primary/10",
            )}
          >
            <Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />
            {FENNEX_AGENTS.zerda.name}
          </button>
        </div>
      </div>

      <GscBanner projectId={projectId} />

      {/* ── Workspace nav ── */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-border">
        {WORKSPACES.map(({ key, label, Icon }) => {
          const active = workspace === key;
          return (
            <button
              key={key}
              onClick={() => setWorkspace(key)}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.8} />
              {label}
              {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>

      {/* ── Content + Copilot side panel ── */}
      <div className="flex items-start gap-5">
        <div className="min-w-0 flex-1">
          {workspace === "pulse" && <OverviewTab projectId={projectId} range={range} />}
          {workspace === "growth" && <OpportunitiesTab projectId={projectId} />}
          {workspace === "market" && <MarketTab projectId={projectId} persona={persona} />}
          {workspace === "competitors" && <CompetitorsTab projectId={projectId} />}
          {workspace === "performance" && <PerformanceTab projectId={projectId} />}
        </div>

        {copilotOpen && (
          <>
            {/* Mobile backdrop */}
            <div className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm xl:hidden" onClick={() => setCopilotOpen(false)} />
            <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col p-3 xl:static xl:z-auto xl:w-[380px] xl:max-w-none xl:shrink-0 xl:self-stretch xl:p-0">
              <div className="h-full min-h-[520px] xl:sticky xl:top-3 xl:h-[calc(100vh-120px)]">
                <CopilotPanel projectId={projectId} persona={persona} onClose={() => setCopilotOpen(false)} />
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
}
