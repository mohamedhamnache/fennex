"use client";

import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus, FileText, BarChart2, Search, ExternalLink } from "lucide-react";
import Link from "next/link";
import {
  listProjects,
  listArticles,
  getAnalyticsOverview,
  type Article,
} from "@/lib/api";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function fmtPct(n: number) {
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

// ─── StatCard ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  change,
  href,
  invertChange = false,
}: {
  label: string;
  value: string;
  change: number;
  href: string;
  invertChange?: boolean;
}) {
  const effective = invertChange ? -change : change;
  const isPositive = effective > 0;
  const isNeutral = Math.abs(effective) < 0.1;

  return (
    <Link href={href} className="rounded-lg border bg-card p-5 flex flex-col gap-2 hover:bg-muted/20 transition-colors">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {!isNeutral && (
        <span className={`flex items-center gap-1 text-xs font-medium ${isPositive ? "text-emerald-600" : "text-red-500"}`}>
          {isPositive ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
          {fmtPct(Math.abs(change))} vs prior period
        </span>
      )}
      {isNeutral && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Minus className="h-3.5 w-3.5" /> No change
        </span>
      )}
    </Link>
  );
}

// ─── ArticleStatusBadge ──────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  generating: "bg-amber-50 text-amber-600",
  ready: "bg-blue-50 text-blue-600",
  published: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-600",
};

function ArticleStatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ─── QuickAction ─────────────────────────────────────────────────────────────

function QuickAction({ icon: Icon, label, href }: { icon: React.ElementType; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm font-medium hover:bg-muted/20 transition-colors"
    >
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      {label}
    </Link>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ProjectOverviewPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 30_000,
  });

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ["analytics", "overview", projectId, "28d"],
    queryFn: () => getAnalyticsOverview(projectId, "28d"),
    staleTime: 5 * 60_000,
  });

  const { data: articles = [], isLoading: articlesLoading } = useQuery({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
    staleTime: 60_000,
  });

  const project = projects.find((p) => p.id === projectId);
  const recentArticles = [...articles]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">{project?.name ?? "Project Overview"}</h1>
        {project?.domain && (
          <a
            href={`https://${project.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mt-1 w-fit"
          >
            {project.domain}
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      {/* Analytics stats — last 28 days */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Last 28 days</h2>
        {overviewLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-lg border bg-card p-5 h-24 animate-pulse bg-muted/30" />
            ))}
          </div>
        ) : overview ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Clicks"
              value={fmtNum(overview.clicks)}
              change={overview.clicks_change}
              href={`/${projectId}/analytics`}
            />
            <StatCard
              label="Impressions"
              value={fmtNum(overview.impressions)}
              change={overview.impressions_change}
              href={`/${projectId}/analytics`}
            />
            <StatCard
              label="Avg CTR"
              value={`${(overview.ctr * 100).toFixed(2)}%`}
              change={overview.ctr_change}
              href={`/${projectId}/analytics`}
            />
            <StatCard
              label="Avg Position"
              value={overview.avg_position.toFixed(1)}
              change={overview.position_change}
              href={`/${projectId}/analytics`}
              invertChange
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No analytics data yet.</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent articles */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">Recent Articles</h2>
            <Link href={`/${projectId}/articles`} className="text-xs text-muted-foreground hover:text-foreground">
              View all →
            </Link>
          </div>
          <div className="rounded-lg border overflow-hidden">
            {articlesLoading ? (
              <div className="p-6 space-y-3">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-8 rounded bg-muted/30 animate-pulse" />
                ))}
              </div>
            ) : recentArticles.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No articles yet.{" "}
                <Link href={`/${projectId}/articles`} className="underline hover:text-foreground">
                  Create one
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {recentArticles.map((article: Article) => (
                    <tr key={article.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/${projectId}/articles`} className="font-medium hover:underline line-clamp-1">
                          {article.title}
                        </Link>
                        {article.target_keyword && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{article.target_keyword}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <ArticleStatusBadge status={article.status} />
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(article.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="text-sm font-medium mb-3">Quick Actions</h2>
          <div className="flex flex-col gap-2">
            <QuickAction icon={Search} label="Run keyword research" href={`/${projectId}/keywords`} />
            <QuickAction icon={FileText} label="Create article" href={`/${projectId}/articles`} />
            <QuickAction icon={BarChart2} label="View analytics" href={`/${projectId}/analytics`} />
          </div>
        </div>
      </div>
    </div>
  );
}
