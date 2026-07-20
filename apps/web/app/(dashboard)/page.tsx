"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, TrendingDown, FileText, MousePointerClick, Eye, Crosshair,
  Search, Zap, Globe, ArrowRight, CheckCircle2, Circle, Sparkles, FolderPlus,
} from "lucide-react";
import {
  listProjects, listArticles, listApiKeys, getGscStatus,
  getAnalyticsOverview, getAnalyticsTraffic, type Article,
} from "@/lib/api";
import { useProjectStore } from "@/lib/store";
import { StatCard } from "@/components/ui/StatCard";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { AutopilotCard } from "@/components/autopilot/AutopilotCard";
import { FENNEX_AGENTS, type AgentId } from "@/lib/agents";

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const ARTICLE_TONE: Record<string, BadgeTone> = {
  draft: "neutral", generating: "warning", ready: "info", published: "success", failed: "danger",
};

// ─── No-project onboarding ─────────────────────────────────────────────────────

function NoProjectState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <header className="aurora-header px-6 py-7">
        <div className="relative z-10 flex items-center gap-3.5">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl gradient-brand text-white glow-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h1 className="font-display text-[28px] font-bold tracking-tight">{t("dashboard.welcomeToFennex")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("dashboard.tagline")}</p>
          </div>
        </div>
      </header>
      <div className="glass flex flex-col items-center justify-center gap-4 px-6 py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl gradient-brand glow-primary">
          <FolderPlus className="h-7 w-7 text-white" strokeWidth={1.9} />
        </div>
        <div>
          <p className="text-base font-semibold">{t("dashboard.noProjects")}</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            A project connects a website so Fennex can research keywords, write articles, and track rankings.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Use the workspace switcher in the sidebar to create one.</p>
      </div>
    </div>
  );
}

// ─── Hero traffic tile ─────────────────────────────────────────────────────────

function HeroTile({
  projectId, clicks, change, traffic,
}: {
  projectId: string | null;
  clicks: number | null;
  change: number | null;
  traffic: { date: string; clicks: number; impressions: number }[];
}) {
  const { t } = useTranslation();
  const data = traffic.map((tr) => ({ ...tr, label: fmtDate(tr.date) }));
  const up = (change ?? 0) >= 0;
  return (
    <div className="glass relative flex flex-col overflow-hidden p-5 lg:col-span-2 lg:row-span-2">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("dashboard.organicClicks")}</p>
          <div className="mt-1 flex items-end gap-3">
            <span className="font-display text-4xl font-bold tracking-tight tabular-nums">
              {clicks !== null ? fmtNum(clicks) : "—"}
            </span>
            {change !== null && (
              <span className={`mb-1 flex items-center gap-1 text-sm font-semibold ${up ? "text-success" : "text-destructive"}`}>
                {up ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                {Math.abs(change).toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        {projectId && (
          <Link href={`/${projectId}/analytics`} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
            Analytics →
          </Link>
        )}
      </div>

      <div className="mt-4 min-h-[200px] flex-1">
        {data.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%" minHeight={200}>
            <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="heroClicks" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="heroStroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#6366f1" />
                  <stop offset="100%" stopColor="#d946ef" />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={32} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                contentStyle={{ background: "hsl(224 44% 8%)", border: "1px solid hsl(0 0% 100% / 0.1)", borderRadius: 10, fontSize: 12, color: "hsl(var(--foreground))" }}
                labelStyle={{ color: "hsl(var(--muted-foreground))" }}
              />
              <Area type="monotone" dataKey="clicks" stroke="url(#heroStroke)" strokeWidth={2.5} fill="url(#heroClicks)"
                style={{ filter: "drop-shadow(0 4px 12px hsl(256 92% 55% / 0.35))" }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
            <Globe className="h-6 w-6 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">{t("dashboard.connectSearchConsole")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Setup progress tile ───────────────────────────────────────────────────────

function SetupTile({ items }: { items: { label: string; done: boolean; href: string }[] }) {
  const { t } = useTranslation();
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);
  return (
    <div className="glass flex flex-col items-center gap-4 p-5">
      <div className="flex w-full items-center justify-between">
        <p className="text-sm font-semibold">{t("dashboard.setup")}</p>
        <Badge tone={done === items.length ? "success" : "primary"}>{done}/{items.length}</Badge>
      </div>
      <ProgressRing value={pct} size={128}>
        <span className="font-display text-2xl font-bold tabular-nums">{pct}%</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("dashboard.complete")}</span>
      </ProgressRing>
      <div className="w-full space-y-1">
        {items.map((it) => (
          <Link key={it.label} href={it.href}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs transition-colors hover:bg-white/[0.04]">
            {it.done
              ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" strokeWidth={2.2} />
              : <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" strokeWidth={2} />}
            <span className={it.done ? "text-muted-foreground line-through" : "text-foreground/80"}>{it.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Quick actions tile ────────────────────────────────────────────────────────

function QuickActionsTile({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const actions = [
    { label: t("dashboard.keywordResearch"), href: `/${projectId}/keywords`, icon: Search, tone: "text-violet-400 bg-violet-500/15" },
    { label: t("dashboard.generateArticle"), href: `/${projectId}/articles`, icon: Zap, tone: "text-primary bg-primary/15" },
    { label: t("dashboard.auditSite"), href: `/${projectId}/audit`, icon: Globe, tone: "text-emerald-400 bg-emerald-500/15" },
  ];
  return (
    <div className="glass p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        {t("dashboard.quickActions")}
      </h2>
      <div className="space-y-1.5">
        {actions.map((a) => (
          <Link key={a.label} href={a.href}
            className="group flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.04]">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${a.tone}`}>
              <a.icon className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <span className="flex-1 text-sm font-medium">{a.label}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary" strokeWidth={2} />
          </Link>
        ))}
      </div>
    </div>
  );
}

// ─── Your Pack strip ───────────────────────────────────────────────────────────

const PACK_GRADIENT: Record<AgentId, string> = {
  zerda: "from-orange-500 to-amber-600",
  sirocco: "from-rose-500 to-orange-500",
  dune: "from-amber-500 to-yellow-600",
  mirage: "from-fuchsia-500 to-rose-500",
  sable: "from-stone-500 to-stone-700",
  oasis: "from-emerald-600 to-teal-600",
  nomad: "from-amber-600 to-red-500",
};

// Each agent's primary surface (routes verified to exist).
const PACK_ROUTE: Record<AgentId, string> = {
  zerda: "analytics",
  sirocco: "campaigns",
  dune: "articles",
  mirage: "images",
  sable: "content",
  oasis: "agents",
  nomad: "backlinks",
};

const PACK_ORDER: AgentId[] = ["dune", "zerda", "sirocco", "mirage", "sable", "oasis", "nomad"];

function PackStrip({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  return (
    <div className="glass p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            {t("dashboard.yourPack")}
          </h2>
          <p className="mt-1 pl-8 text-xs text-muted-foreground">{t("dashboard.yourPackSub")}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {PACK_ORDER.map((id) => {
          const agent = FENNEX_AGENTS[id];
          return (
            <Link
              key={id}
              href={`/${projectId}/${PACK_ROUTE[id]}`}
              className="group flex flex-col items-center gap-2 rounded-xl border border-white/[0.05] bg-white/[0.02] px-2 py-3.5 text-center transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:bg-white/[0.04]"
            >
              <span className={`flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-sm transition-transform group-hover:scale-105 ${PACK_GRADIENT[id]}`}>
                <agent.Icon className="h-5 w-5" strokeWidth={1.9} />
              </span>
              <span className="text-xs font-semibold text-foreground">{agent.name}</span>
              <span className="line-clamp-2 text-[10px] leading-tight text-muted-foreground">{agent.role}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { t } = useTranslation();
  const { currentProjectId } = useProjectStore();

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"], queryFn: listProjects, staleTime: 30_000,
  });
  const project = projects.find((p) => p.id === currentProjectId) ?? projects[0] ?? null;
  const projectId = project?.id ?? null;

  const { data: overview } = useQuery({
    queryKey: ["analytics", "overview", projectId, "28d"],
    queryFn: () => getAnalyticsOverview(projectId!, "28d"),
    enabled: !!projectId, staleTime: 5 * 60_000,
  });
  const { data: traffic = [] } = useQuery({
    queryKey: ["analytics", "traffic", projectId, "28d"],
    queryFn: () => getAnalyticsTraffic(projectId!, "28d"),
    enabled: !!projectId, staleTime: 5 * 60_000,
  });
  const { data: articles = [] } = useQuery({
    queryKey: ["articles", projectId], queryFn: () => listArticles(projectId!),
    enabled: !!projectId, staleTime: 60_000,
  });
  const { data: apiKeys = [] } = useQuery({ queryKey: ["api-keys"], queryFn: listApiKeys, staleTime: 60_000 });
  const { data: gsc } = useQuery({
    queryKey: ["gsc-status", projectId], queryFn: () => getGscStatus(projectId!),
    enabled: !!projectId, staleTime: 60_000,
  });

  if (!projectsLoading && projects.length === 0) return <NoProjectState />;

  const publishedCount = articles.filter((a) => a.status === "published").length;
  const recentArticles = [...articles]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const checklist = [
    { label: t("dashboard.setupSteps.createProject"), done: projects.length > 0, href: "#" },
    { label: t("dashboard.setupSteps.connectKeys"), done: apiKeys.length > 0, href: "/settings" },
    { label: t("dashboard.setupSteps.connectSearchConsole"), done: !!gsc?.is_connected, href: projectId ? `/${projectId}/analytics` : "#" },
    { label: t("dashboard.setupSteps.generateArticle"), done: articles.length > 0, href: projectId ? `/${projectId}/articles` : "#" },
  ];

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* Greeting header */}
      <header className="aurora-header flex items-center justify-between px-6 py-5">
        <div className="relative z-10">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("dashboard.commandCenter")}</p>
          <h1 className="mt-1 font-display text-[28px] font-bold tracking-tight">
            {t("dashboard.welcomeBack")}{project ? <span className="text-gradient-brand">, {project.name}</span> : ""}
          </h1>
        </div>
        {projectId && (
          <Link href={`/${projectId}/overview`} className="btn-aurora relative z-10 inline-flex items-center gap-1.5 px-4 py-2 text-xs">
            {t("dashboard.projectOverview")} <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </header>

      {projectId && <AutopilotCard projectId={projectId} />}

      {/* Bento: hero + setup */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <HeroTile
          projectId={projectId}
          clicks={overview?.clicks ?? null}
          change={overview?.clicks_change ?? null}
          traffic={traffic.map((tr) => ({ date: tr.date, clicks: tr.clicks, impressions: tr.impressions }))}
        />
        <SetupTile items={checklist} />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatCard label={t("dashboard.stats.impressions")} tone="violet" icon={Eye}
          value={overview ? fmtNum(overview.impressions) : "—"} change={overview?.impressions_change}
          spark={traffic.map((tr) => tr.impressions)} href={projectId ? `/${projectId}/analytics` : undefined} />
        <StatCard label={t("dashboard.stats.avgCtr")} tone="emerald" icon={TrendingUp}
          value={overview ? `${(overview.ctr * 100).toFixed(1)}%` : "—"} change={overview?.ctr_change}
          href={projectId ? `/${projectId}/analytics` : undefined} />
        <StatCard label={t("dashboard.stats.avgPosition")} tone="amber" icon={Crosshair}
          value={overview ? overview.avg_position.toFixed(1) : "—"} change={overview?.position_change} invertChange
          href={projectId ? `/${projectId}/analytics` : undefined} />
        <StatCard label={t("dashboard.stats.published")} tone="primary" icon={FileText}
          value={String(publishedCount)} href={projectId ? `/${projectId}/articles` : undefined} />
      </div>

      {/* Your Pack */}
      {projectId && <PackStrip projectId={projectId} />}

      {/* Activity + quick actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="glass overflow-hidden lg:col-span-2">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-3.5 w-3.5" strokeWidth={2} />
              </span>
              {t("dashboard.recentArticles")}
            </h2>
            {projectId && (
              <Link href={`/${projectId}/articles`} className="group inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground">
                {t("common.viewAll")}
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </Link>
            )}
          </div>
          {recentArticles.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-12 text-center">
              <div className="rounded-full bg-white/[0.04] p-3"><FileText className="h-4 w-4 text-muted-foreground/50" strokeWidth={1.5} /></div>
              <div>
                <p className="text-sm font-medium">{t("dashboard.noArticlesYet")}</p>
                {projectId && <Link href={`/${projectId}/articles`} className="text-xs text-primary hover:underline">{t("dashboard.generateFirstArticle")}</Link>}
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              {recentArticles.map((a: Article) => (
                <Link
                  key={a.id}
                  href={projectId ? `/${projectId}/articles` : "#"}
                  className="group flex items-center gap-3 border-t border-white/[0.05] px-5 py-3 transition-colors hover:bg-white/[0.03]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileText className="h-4 w-4" strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm font-medium transition-colors group-hover:text-primary">{a.title}</p>
                    {a.target_keyword && <p className="mt-0.5 truncate text-xs text-muted-foreground">{a.target_keyword}</p>}
                  </div>
                  <Badge tone={ARTICLE_TONE[a.status] ?? "neutral"}>{a.status.charAt(0).toUpperCase() + a.status.slice(1)}</Badge>
                  <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:block">{fmtDate(a.created_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {projectId ? <QuickActionsTile projectId={projectId} /> : <div className="glass p-5 text-center text-sm text-muted-foreground">{t("dashboard.selectProject")}</div>}
      </div>
    </div>
  );
}
