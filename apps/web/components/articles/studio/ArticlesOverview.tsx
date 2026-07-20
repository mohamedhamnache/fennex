"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus, Search, FileText, FileEdit, CheckCircle2, Gauge,
  MoreHorizontal, RefreshCw, XCircle, ArrowRight, type LucideIcon,
} from "lucide-react";
import { FennecMascot } from "@fennex/ui";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { FENNEX_AGENTS } from "@/lib/agents";
import type { Article, ArticleStatus } from "@/lib/api";

const STATUS_TONE: Record<ArticleStatus, BadgeTone> = {
  draft: "neutral",
  generating: "warning",
  ready: "info",
  published: "success",
  failed: "danger",
};

type Filter = "all" | "draft" | "ready" | "published";
const FILTERS: Filter[] = ["all", "draft", "ready", "published"];

function seoColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-500";
  if (score >= 60) return "text-amber-500";
  return "text-red-500";
}

function StatTile({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: string }) {
  return (
    <div className="glass flex items-center gap-3 p-4">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tone)}>
        <Icon className="h-5 w-5" strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="font-display text-xl font-bold tabular-nums leading-tight">{value}</p>
      </div>
    </div>
  );
}

interface ArticlesOverviewProps {
  articles: Article[];
  isLoading: boolean;
  onOpen: (id: string) => void;
  onNewArticle: () => void;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * The Articles landing (no article selected): an at-a-glance dashboard with
 * headline stats, status filters, search, and a responsive card grid. Opening
 * any card switches the page into the three-pane editor.
 */
export function ArticlesOverview({
  articles,
  isLoading,
  onOpen,
  onNewArticle,
  onRegenerate,
  onDelete,
}: ArticlesOverviewProps) {
  const { t, i18n } = useTranslation();
  const dune = FENNEX_AGENTS.dune;
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const stats = useMemo(() => {
    const drafts = articles.filter((a) => a.status === "draft").length;
    const published = articles.filter((a) => a.status === "published").length;
    const scored = articles.filter((a) => a.seo_score !== null);
    const avg = scored.length
      ? Math.round(scored.reduce((s, a) => s + (a.seo_score ?? 0), 0) / scored.length)
      : null;
    return { total: articles.length, drafts, published, avg };
  }, [articles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => {
      if (filter !== "all" && a.status !== filter) return false;
      if (q && !a.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [articles, filter, query]);

  const filterCount = (f: Filter) =>
    f === "all" ? articles.length : articles.filter((a) => a.status === f).length;

  return (
    <section className="glass flex min-w-0 flex-1 flex-col overflow-hidden">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-border px-6 py-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: "radial-gradient(620px 200px at 15% -20%, hsl(var(--primary) / 0.12), transparent 60%)" }}
        />
        <div className="relative flex items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl gradient-brand glow-primary">
              <dune.Icon className="h-6 w-6 text-white" strokeWidth={1.9} />
            </span>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight">{t("articleStudio.overview.heading")}</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("articles.subtitle")}</p>
            </div>
          </div>
          <button onClick={onNewArticle} className="btn-primary flex shrink-0 items-center gap-2 px-4 py-2.5 text-xs">
            <Plus className="h-3.5 w-3.5" /> {t("articles.newArticle")}
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile icon={FileText} label={t("articleStudio.overview.total")} value={String(stats.total)} tone="bg-primary/12 text-primary" />
          <StatTile icon={FileEdit} label={t("articleStudio.overview.drafts")} value={String(stats.drafts)} tone="bg-amber-500/15 text-amber-400" />
          <StatTile icon={CheckCircle2} label={t("articleStudio.overview.published")} value={String(stats.published)} tone="bg-emerald-500/15 text-emerald-400" />
          <StatTile icon={Gauge} label={t("articleStudio.overview.avgSeo")} value={stats.avg !== null ? String(stats.avg) : "—"} tone="bg-amber-500/15 text-amber-400" />
        </div>

        {/* Filters + search */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === f ? "bg-primary/12 text-primary" : "bg-muted/50 text-muted-foreground hover:bg-muted",
                )}
              >
                {t(`articleStudio.overview.filters.${f}`)}
                <span className="tabular-nums opacity-70">{filterCount(f)}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto min-w-[180px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("articleStudio.search")}
              className="w-full rounded-lg border border-border bg-input py-1.5 pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        </div>

        {/* Grid */}
        <div className="mt-4">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-32 animate-pulse rounded-2xl bg-white/[0.04]" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-16 text-center">
              <FennecMascot />
              <div>
                <p className="text-sm font-semibold text-foreground">{t("articles.noArticles")}</p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">{t("articleStudio.overview.emptyHint")}</p>
              </div>
              <button onClick={onNewArticle} className="btn-primary flex items-center gap-2 px-4 py-2 text-xs">
                <Plus className="h-3.5 w-3.5" /> {t("articles.newArticle")}
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((a) => (
                <ArticleCard
                  key={a.id}
                  article={a}
                  locale={i18n.language}
                  onOpen={() => onOpen(a.id)}
                  onRegenerate={() => onRegenerate(a.id)}
                  onDelete={() => onDelete(a.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ArticleCard({
  article,
  locale,
  onOpen,
  onRegenerate,
  onDelete,
}: {
  article: Article;
  locale: string;
  onOpen: () => void;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      onClick={onOpen}
      className="glass-hover group relative flex cursor-pointer flex-col gap-3 overflow-hidden rounded-2xl border border-white/[0.05] p-4"
    >
      {/* top accent */}
      <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-0.5 gradient-brand opacity-0 transition-opacity group-hover:opacity-100" />

      <div className="flex items-start justify-between gap-2">
        <Badge tone={STATUS_TONE[article.status]} dot className="capitalize">
          {article.status}
        </Badge>
        <div className="relative" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-8 z-20 w-36 overflow-hidden rounded-xl border border-border bg-card shadow-lg animate-scale-in">
                <button
                  onClick={() => { setMenuOpen(false); onRegenerate(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground transition-colors hover:bg-accent"
                >
                  <RefreshCw className="h-3.5 w-3.5" /> {t("articles.card.regenerate")}
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    if (window.confirm(t("articleStudio.confirmDelete"))) onDelete();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
                >
                  <XCircle className="h-3.5 w-3.5" /> {t("articles.card.delete")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
            {article.title}
          </p>
          {article.target_keyword && (
            <span className="mt-2 inline-block max-w-full truncate rounded-full bg-muted/60 px-2 py-0.5 text-[10px] text-muted-foreground">
              {article.target_keyword}
            </span>
          )}
        </div>
        {article.seo_score !== null && (
          <ProgressRing value={article.seo_score} size={44} stroke={4}>
            <span className={`text-[11px] font-bold tabular-nums ${seoColor(article.seo_score)}`}>
              {article.seo_score}
            </span>
          </ProgressRing>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border pt-2.5 text-[11px] text-muted-foreground">
        <span>{new Date(article.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" })}</span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
    </div>
  );
}
