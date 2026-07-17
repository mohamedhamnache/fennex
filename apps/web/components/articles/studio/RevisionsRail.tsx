"use client";

import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, GitCommitHorizontal, History, RotateCcw, Eye } from "lucide-react";
import { listArticleRevisions } from "@/lib/api";

interface RevisionsRailProps {
  articleId: string;
  currentWordCount: number;
  onBackToOverview: () => void;
  onNewArticle: () => void;
  onSaveRevision: () => void;
  isSavingRevision: boolean;
  onRestore: (body: string) => void;
  onCompare: (body: string) => void;
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
}

function relTime(iso: string, locale: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (mins < 60) return rtf.format(-mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

/**
 * Left rail in editor mode: the article's revision history as a commit-style
 * timeline. The current draft sits at the top (HEAD); saved revisions follow,
 * each restorable. Save revision creates a new commit.
 */
export function RevisionsRail({
  articleId,
  currentWordCount,
  onBackToOverview,
  onNewArticle,
  onSaveRevision,
  isSavingRevision,
  onRestore,
  onCompare,
  mobileOpen = false,
  onCloseMobile,
}: RevisionsRailProps) {
  const { t, i18n } = useTranslation();

  const { data: revisions = [], isLoading } = useQuery({
    queryKey: ["article-revisions", articleId],
    queryFn: () => listArticleRevisions(articleId),
  });

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
        <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          <History className="h-3 w-3" />
          {t("articleStudio.revisions.title")}
        </div>
        <button
          onClick={onSaveRevision}
          disabled={isSavingRevision}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
        >
          <GitCommitHorizontal className="h-3.5 w-3.5" />
          {t("articles.editor.saveRevision")}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {/* Timeline */}
        <ol className="relative flex flex-col">
          {/* HEAD — current draft */}
          <li className="relative flex gap-3 pb-4 pl-1">
            <span className="absolute left-[7px] top-4 h-full w-px bg-border" />
            <span className="relative z-10 mt-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-primary">{t("articleStudio.revisions.current")}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                {t("articleStudio.words", { count: currentWordCount })}
              </p>
            </div>
          </li>

          {isLoading ? (
            [...Array(3)].map((_, i) => (
              <li key={i} className="mb-2 h-10 animate-pulse rounded-lg bg-white/[0.04]" />
            ))
          ) : revisions.length === 0 ? (
            <li className="pl-1 pt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t("articleStudio.revisions.empty")}
            </li>
          ) : (
            revisions.map((r, i) => (
              <li key={r.id} className="group relative flex gap-3 pb-4 pl-1">
                {i < revisions.length - 1 && (
                  <span className="absolute left-[7px] top-4 h-full w-px bg-border" />
                )}
                <span className="relative z-10 mt-1 h-3.5 w-3.5 rounded-full border-2 border-border bg-card transition-colors group-hover:border-primary/60" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-medium text-foreground">
                      {r.note || t("articleStudio.revisions.note")}
                    </p>
                    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={() => onCompare(r.body_markdown)}
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                        title={t("articleStudio.revisions.compare")}
                      >
                        <Eye className="h-3 w-3" />
                        {t("articleStudio.revisions.compare")}
                      </button>
                      <button
                        onClick={() => onRestore(r.body_markdown)}
                        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                        title={t("articleStudio.revisions.restore")}
                      >
                        <RotateCcw className="h-3 w-3" />
                        {t("articleStudio.revisions.restore")}
                      </button>
                    </span>
                  </div>
                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
                    <span>{relTime(r.created_at, i18n.language)}</span>
                    <span className="opacity-50">·</span>
                    <span>{t("articleStudio.words", { count: r.word_count })}</span>
                  </p>
                </div>
              </li>
            ))
          )}
        </ol>
      </div>
    </>
  );

  return (
    <>
      <aside className="glass hidden w-60 shrink-0 flex-col overflow-hidden lg:flex">{content}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fade-in" onClick={onCloseMobile} />
          <aside className="glass animate-scale-in relative z-10 flex h-full w-72 max-w-[85vw] origin-left flex-col overflow-hidden">
            {content}
          </aside>
        </div>
      )}
    </>
  );
}
