"use client";

import { useQuery } from "@tanstack/react-query";
import { FileText, BarChart2, Search, ExternalLink, Globe, MousePointerClick, Eye, TrendingUp, Crosshair } from "lucide-react";
import Link from "next/link";
import {
  listProjects,
  listArticles,
  getAnalyticsOverview,
  getAnalyticsTraffic,
  type Article,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  generating: "warning",
  ready: "info",
  published: "success",
  failed: "danger",
};

// ─── QuickAction ─────────────────────────────────────────────────────────────

function QuickAction({ icon: Icon, label, href }: { icon: React.ElementType; label: string; href: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-primary/25 hover:bg-accent"
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.9} />
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

  const { data: traffic = [] } = useQuery({
    queryKey: ["analytics", "traffic", projectId, "28d"],
    queryFn: () => getAnalyticsTraffic(projectId, "28d"),
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

  const clicksSpark = traffic.map((t) => t.clicks);
  const imprSpark = traffic.map((t) => t.impressions);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        title={project?.name ?? "Project Overview"}
        icon={Globe}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: project?.name ?? "Project" }]}
        description={
          project?.domain ? (
            <a
              href={`https://${project.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              {project.domain}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            "Your organic growth at a glance."
          )
        }
        actions={
          <Link href={`/${projectId}/articles`} className="btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs">
            <FileText className="h-3.5 w-3.5" /> New article
          </Link>
        }
      />

      {/* Analytics stats — last 28 days */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Last 28 days</h2>
        {overviewLoading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl border bg-muted/30" />
            ))}
          </div>
        ) : overview ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Clicks" tone="primary" icon={MousePointerClick}
              value={fmtNum(overview.clicks)} change={overview.clicks_change}
              spark={clicksSpark} href={`/${projectId}/analytics`}
            />
            <StatCard
              label="Impressions" tone="violet" icon={Eye}
              value={fmtNum(overview.impressions)} change={overview.impressions_change}
              spark={imprSpark} href={`/${projectId}/analytics`}
            />
            <StatCard
              label="Avg CTR" tone="emerald" icon={TrendingUp}
              value={`${(overview.ctr * 100).toFixed(2)}%`} change={overview.ctr_change}
              href={`/${projectId}/analytics`}
            />
            <StatCard
              label="Avg Position" tone="amber" icon={Crosshair}
              value={overview.avg_position.toFixed(1)} change={overview.position_change}
              href={`/${projectId}/analytics`} invertChange
            />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No analytics data yet.</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent articles */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">Recent Articles</h2>
            <Link href={`/${projectId}/articles`} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
              View all →
            </Link>
          </div>
          <Card className="overflow-hidden">
            {articlesLoading ? (
              <div className="space-y-3 p-6">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-8 animate-pulse rounded bg-muted/30" />
                ))}
              </div>
            ) : recentArticles.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No articles yet.{" "}
                <Link href={`/${projectId}/articles`} className="text-primary hover:underline">
                  Create one
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {recentArticles.map((article: Article) => (
                    <tr key={article.id} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link href={`/${projectId}/articles`} className="line-clamp-1 font-medium hover:underline">
                          {article.title}
                        </Link>
                        {article.target_keyword && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{article.target_keyword}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Badge tone={STATUS_TONE[article.status] ?? "neutral"}>
                          {article.status.charAt(0).toUpperCase() + article.status.slice(1)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted-foreground">
                        {new Date(article.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="mb-3 text-sm font-medium">Quick Actions</h2>
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
