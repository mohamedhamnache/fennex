"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Plus, Search, FileText, FileEdit, CheckCircle2, Gauge,
  MoreHorizontal, RefreshCw, XCircle, Hash, Clock,
  type LucideIcon,
} from "lucide-react";
import { FennecMascot } from "@fennex/ui";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
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

// GEO ("answer-engine readiness") lives on a 0-100 scale where structure alone
// tops out near 70; tune the color bands accordingly.
function geoColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 70) return "text-emerald-500";
  if (score >= 45) return "text-amber-500";
  return "text-red-500";
}

function StatTile({ icon: Icon, label, value, tone }: { icon: LucideIcon; label: string; value: string; tone: string }) {
  return (
    <div className="glass glass-hover group flex items-center gap-3.5 p-4">
      <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105", tone)}>
        <Icon className="h-5 w-5" strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="font-display text-2xl font-bold tabular-nums leading-tight">{value}</p>
      </div>
    </div>
  );
}

/** A compact SEO/GEO score pill used in the footer of each article card. */
function ScorePill({ label, score, color, title }: { label: string; score: number | null; color: string; title: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-lg bg-muted/60 px-2 py-1 text-[11px]"
      title={title}
    >
      <span className="font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn("font-bold tabular-nums", score !== null ? color : "text-muted-foreground/40")}>
        {score !== null ? Math.round(score) : "—"}
      </span>
    </span>
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
 * The Articles landing (no article selected): a warm editorial "content desk"
 * with headline stats, status filters, search, and a responsive card grid.
 * Opening any card switches the page into the three-pane editor.
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
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(680px 220px at 12% -30%, hsl(var(--primary) / 0.16), transparent 62%), radial-gradient(520px 200px at 100% -10%, hsl(var(--primary-accent) / 0.10), transparent 60%)" }}
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
          <StatTile icon={Gauge} label={t("articleStudio.overview.avgSeo")} value={stats.avg !== null ? String(stats.avg) : "—"} tone="bg-primary/12 text-primary" />
        </div>

        {/* Filters + search */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  filter === f
                    ? "bg-card text-primary shadow-sm ring-1 ring-inset ring-primary/15"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`articleStudio.overview.filters.${f}`)}
                <span className="tabular-nums opacity-60">{filterCount(f)}</span>
              </button>
            ))}
          </div>
          <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("articleStudio.search")}
              className="w-full rounded-xl border border-border bg-input py-2 pl-9 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>
        </div>

        {/* Grid */}
        <div className="mt-5">
          {isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-[168px] animate-pulse rounded-2xl border border-border bg-white/[0.03]" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border py-16 text-center">
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
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
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
    <article
      onClick={onOpen}
      className="tilt-card group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-border bg-card/50 p-5"
    >
      {/* Header: status + actions */}
      <div className="flex items-center justify-between gap-2">
        <Badge tone={STATUS_TONE[article.status]} dot className="capitalize">
          {t(`articleStudio.overview.filters.${article.status}`, { defaultValue: article.status })}
        </Badge>
        <div className="relative flex shrink-0 justify-end" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-lg p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus:opacity-100 group-hover:opacity-100"
            aria-label={t("articleStudio.overview.rowActions")}
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
                  onClick={() => { setMenuOpen(false); if (window.confirm(t("articleStudio.confirmDelete"))) onDelete(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-destructive transition-colors hover:bg-destructive/10"
                >
                  <XCircle className="h-3.5 w-3.5" /> {t("articles.card.delete")}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Title */}
      <h3 className="mt-3 line-clamp-2 min-h-[2.7em] font-display text-[17px] font-semibold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary">
        {article.title || t("articleStudio.overview.untitled")}
      </h3>

      {/* Keyword */}
      {article.target_keyword ? (
        <span className="mt-2 inline-flex max-w-full items-center gap-1.5 self-start rounded-full border border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary">
          <Hash className="h-3 w-3 shrink-0" />
          <span className="truncate">{article.target_keyword}</span>
        </span>
      ) : (
        <span className="mt-2 h-[26px]" aria-hidden />
      )}

      {/* Footer: scores + date */}
      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/70 pt-3.5">
        <div className="flex items-center gap-1.5">
          <ScorePill label={t("articleStudio.overview.cols.seo")} score={article.seo_score} color={seoColor(article.seo_score)} title={t("articles.editor.seoScore")} />
          <ScorePill label={t("articleStudio.overview.cols.geo")} score={article.geo_score} color={geoColor(article.geo_score)} title={t("articles.editor.geoScore")} />
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {new Date(article.created_at).toLocaleDateString(locale, { month: "short", day: "numeric" })}
        </span>
      </div>
    </article>
  );
}
