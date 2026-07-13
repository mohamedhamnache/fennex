"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Plus, Search, MoreHorizontal, RefreshCw, XCircle, ArrowLeft } from "lucide-react";
import { FennecMascot } from "@fennex/ui";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import type { Article, ArticleStatus } from "@/lib/api";

const STATUS_TONE: Record<ArticleStatus, BadgeTone> = {
  draft: "neutral",
  generating: "warning",
  ready: "info",
  published: "success",
  failed: "danger",
};

type RailFilter = "all" | "draft" | "ready" | "published";
const RAIL_FILTERS: RailFilter[] = ["all", "draft", "ready", "published"];

function seoColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-500";
  if (score >= 60) return "text-amber-500";
  return "text-red-500";
}

interface DocumentsRailProps {
  articles: Article[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNewArticle: () => void;
  onBackToOverview: () => void;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
  /** Mobile/narrow-viewport overlay state (ignored at `lg` and above, where the rail is always visible). */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

/**
 * Left rail of the article studio: searchable document list. Reuses the
 * existing status->tone map and SEO color scale from the article list/editor.
 *
 * Below `lg`, the rail is hidden by default and only rendered as a fixed
 * overlay (with backdrop) when `mobileOpen` is true, toggled from a button in
 * the canvas header. At `lg` and above it renders as the static column.
 */
export function DocumentsRail({
  articles,
  isLoading,
  selectedId,
  onSelect,
  onNewArticle,
  onBackToOverview,
  onRegenerate,
  onDelete,
  mobileOpen = false,
  onCloseMobile,
}: DocumentsRailProps) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RailFilter>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return articles.filter((a) => {
      if (filter !== "all" && a.status !== filter) return false;
      if (q && !a.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [articles, query, filter]);

  function handleSelect(id: string) {
    onSelect(id);
    onCloseMobile?.();
  }

  const content = (
    <>
      <div className="flex flex-col gap-2 border-b border-white/[0.06] px-3 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onBackToOverview}
            className="flex flex-1 items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("articleStudio.overview.backToOverview")}
            <span className="ml-auto tabular-nums opacity-60">{articles.length}</span>
          </button>
          <button
            onClick={onNewArticle}
            className="btn-primary flex h-7 w-7 shrink-0 items-center justify-center"
            aria-label={t("articles.newArticle")}
            title={t("articles.newArticle")}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("articleStudio.search")}
            className="w-full rounded-lg border border-border bg-input py-1.5 pl-8 pr-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {RAIL_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
                filter === f ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent",
              )}
            >
              {t(`articleStudio.overview.filters.${f}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="space-y-2 p-1">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-lg bg-white/[0.04]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-3 py-10 text-center">
            <FennecMascot />
            <p className="text-xs font-medium text-muted-foreground">{t("articles.noArticles")}</p>
          </div>
        ) : (
          filtered.map((a) => {
            const isSel = a.id === selectedId;
            return (
              <div
                key={a.id}
                className={cn(
                  "group relative mb-1 flex w-full flex-col gap-1.5 rounded-xl px-3 py-2.5 text-left transition-colors",
                  isSel ? "bg-primary/12" : "hover:bg-white/[0.04]",
                )}
              >
                {isSel && (
                  <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
                )}
                <button onClick={() => handleSelect(a.id)} className="flex flex-col gap-1.5 text-left">
                  <p className={cn("line-clamp-1 text-sm font-medium pr-5", isSel ? "text-foreground" : "text-foreground/85")}>
                    {a.title}
                  </p>
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[a.status]} dot className="capitalize">
                      {a.status}
                    </Badge>
                    {a.seo_score !== null && (
                      <span className={`text-[11px] font-semibold tabular-nums ${seoColor(a.seo_score)}`}>
                        SEO {a.seo_score}
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {new Date(a.created_at).toLocaleDateString(i18n.language, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                </button>
                <RowMenu
                  onRegenerate={() => onRegenerate(a.id)}
                  onDelete={() => onDelete(a.id)}
                />
              </div>
            );
          })
        )}
      </div>
    </>
  );

  return (
    <>
      {/* Desktop: static column, always visible at lg+ */}
      <aside className="glass hidden w-60 shrink-0 flex-col overflow-hidden lg:flex">
        {content}
      </aside>

      {/* Mobile/narrow: overlay drawer, shown only when toggled open */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in"
            onClick={onCloseMobile}
          />
          <aside className="glass animate-scale-in relative z-10 flex h-full w-72 max-w-[85vw] origin-left flex-col overflow-hidden">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}

function RowMenu({ onRegenerate, onDelete }: { onRegenerate: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={menuRef} className="absolute right-1.5 top-1.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-lg p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-36 rounded-xl border border-border bg-card shadow-lg overflow-hidden">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRegenerate();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-foreground hover:bg-accent transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {t("articles.card.regenerate")}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              if (window.confirm(t("articleStudio.confirmDelete"))) {
                onDelete();
              }
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10 transition-colors"
          >
            <XCircle className="h-3.5 w-3.5" />
            {t("articles.card.delete")}
          </button>
        </div>
      )}
    </div>
  );
}
