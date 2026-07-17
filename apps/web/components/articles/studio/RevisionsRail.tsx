"use client";

import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, Plus, GitCommitHorizontal, History, RotateCcw, Eye, Wand2,
} from "lucide-react";
import { listArticleRevisions, type ArticleRevision } from "@/lib/api";

/** Note sentinel written by the studio when it snapshots before a Dune apply. */
const AUTO_NOTE = "auto:dune-apply";

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

function Delta({ value }: { value: number }) {
  if (value === 0) return null;
  const up = value > 0;
  return (
    <span
      className={`rounded-full px-1.5 py-px text-[10px] font-semibold tabular-nums ${
        up ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
      }`}
    >
      {up ? "+" : ""}
      {value}
    </span>
  );
}

/**
 * Left rail in editor mode: the article's revision history as a commit-style
 * timeline. HEAD (current draft) on top with its delta vs the last snapshot;
 * each revision shows version number, label, relative time, word count and
 * delta, with icon actions (compare / restore) on hover.
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

  const headDelta = revisions.length > 0 ? currentWordCount - revisions[0].word_count : 0;

  function labelFor(r: ArticleRevision): string {
    if (r.note === AUTO_NOTE) return t("articleStudio.revisions.auto");
    return r.note || t("articleStudio.revisions.note");
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
        <div className="flex items-center justify-between px-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            <History className="h-3 w-3" />
            {t("articleStudio.revisions.title")}
          </span>
          <span className="tabular-nums text-[10px] text-muted-foreground/60">{revisions.length}</span>
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <ol className="relative flex flex-col">
          {/* HEAD - current draft */}
          <li className="relative flex gap-2.5 pb-4">
            {(revisions.length > 0 || isLoading) && (
              <span className="absolute left-[6px] top-4 h-full w-px bg-border" aria-hidden />
            )}
            <span className="relative z-10 mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]">
              <span className="h-1.5 w-1.5 rounded-full bg-white" />
            </span>
            <div className="min-w-0 flex-1 rounded-xl border border-primary/25 bg-primary/[0.05] px-2.5 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs font-semibold text-primary">
                  {t("articleStudio.revisions.current")}
                </p>
                <Delta value={headDelta} />
              </div>
              <p className="mt-0.5 text-[10px] tabular-nums text-muted-foreground">
                {t("articleStudio.words", { count: currentWordCount })}
              </p>
            </div>
          </li>

          {isLoading ? (
            [...Array(3)].map((_, i) => (
              <li key={i} className="mb-2 ml-6 h-12 animate-pulse rounded-xl bg-white/[0.04]" />
            ))
          ) : revisions.length === 0 ? (
            <li className="ml-6 text-[11px] leading-relaxed text-muted-foreground">
              {t("articleStudio.revisions.empty")}
            </li>
          ) : (
            revisions.map((r, i) => {
              const prev = revisions[i + 1];
              const delta = prev ? r.word_count - prev.word_count : 0;
              const version = revisions.length - i;
              const isAuto = r.note === AUTO_NOTE;
              return (
                <li key={r.id} className="group relative flex gap-2.5 pb-3">
                  {i < revisions.length - 1 && (
                    <span className="absolute left-[6px] top-4 h-full w-px bg-border" aria-hidden />
                  )}
                  <span className="relative z-10 mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 border-border bg-card transition-colors group-hover:border-primary/60">
                    {isAuto && <Wand2 className="h-2 w-2 text-primary/70" strokeWidth={2.5} />}
                  </span>
                  <div className="min-w-0 flex-1 rounded-xl px-2.5 py-1.5 transition-colors group-hover:bg-white/[0.04]">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-xs font-medium text-foreground">
                        <span className="mr-1.5 tabular-nums text-[10px] font-semibold text-muted-foreground/70">
                          v{version}
                        </span>
                        {labelFor(r)}
                      </p>
                      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => onCompare(r.body_markdown)}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                          title={t("articleStudio.revisions.compare")}
                          aria-label={t("articleStudio.revisions.compare")}
                        >
                          <Eye className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => onRestore(r.body_markdown)}
                          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                          title={t("articleStudio.revisions.restore")}
                          aria-label={t("articleStudio.revisions.restore")}
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      </span>
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[10px] tabular-nums text-muted-foreground">
                      <span>{relTime(r.created_at, i18n.language)}</span>
                      <span className="opacity-50">·</span>
                      <span>{t("articleStudio.words", { count: r.word_count })}</span>
                      <Delta value={delta} />
                    </p>
                  </div>
                </li>
              );
            })
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
