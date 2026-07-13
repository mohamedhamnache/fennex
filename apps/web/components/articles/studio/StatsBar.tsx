"use client";

import { useTranslation } from "react-i18next";
import { CheckCircle2, BookOpen, Send, RefreshCw } from "lucide-react";

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      width={size}
      height={size}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function seoColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-500";
  if (score >= 60) return "text-amber-500";
  return "text-red-500";
}

interface StatsBarProps {
  wordCount: number;
  seoScore: number | null;
  onRefetchSeo: () => void;
  saveState: "idle" | "saving" | "saved";
  canPublish: boolean;
  onSaveRevision: () => void;
  isSavingRevision: boolean;
  onPublish: () => void;
}

/**
 * Below-title strip in the writing canvas: live word count + reading time,
 * SEO score chip, autosave state, and the relocated Save Revision / Publish
 * actions (moved from the editor toolbar / right sidebar).
 */
export function StatsBar({
  wordCount,
  seoScore,
  onRefetchSeo,
  saveState,
  canPublish,
  onSaveRevision,
  isSavingRevision,
  onPublish,
}: StatsBarProps) {
  const { t } = useTranslation();
  const readingMinutes = Math.ceil(wordCount / 200);

  return (
    <div className="flex items-center gap-2 border-b border-border px-5 py-2.5 text-xs">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-muted-foreground tabular-nums">
        {t("articleStudio.words", { count: wordCount })}
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-muted-foreground tabular-nums">
        {t("articleStudio.readingTime", { min: readingMinutes })}
      </span>

      {seoScore !== null && (
        <button
          onClick={onRefetchSeo}
          title={t("articles.editor.seoScore")}
          className="group inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 transition-colors hover:bg-muted"
        >
          <span className={`font-semibold tabular-nums ${seoColor(seoScore)}`}>SEO {seoScore}</span>
          <RefreshCw className="h-3 w-3 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
        </button>
      )}
      {seoScore === null && (
        <button
          onClick={onRefetchSeo}
          title={t("articles.editor.seoScore")}
          className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-muted-foreground transition-colors hover:bg-muted"
        >
          SEO <RefreshCw className="h-3 w-3" />
        </button>
      )}

      <span className="flex-1" />

      {saveState === "saving" && (
        <span className="flex items-center gap-1 text-muted-foreground shrink-0">
          <Spinner size={12} /> {t("articles.editor.saving")}
        </span>
      )}
      {saveState === "saved" && (
        <span className="flex items-center gap-1 text-emerald-500 shrink-0">
          <CheckCircle2 className="h-3.5 w-3.5" /> {t("articles.editor.saved")}
        </span>
      )}

      <button
        onClick={onSaveRevision}
        disabled={isSavingRevision}
        className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-60 shrink-0"
      >
        {isSavingRevision ? <Spinner size={12} /> : <BookOpen className="h-3.5 w-3.5" />}
        {t("articles.editor.saveRevision")}
      </button>

      {canPublish && (
        <button
          onClick={onPublish}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors shrink-0"
        >
          <Send className="h-3.5 w-3.5" />
          {t("articles.editor.publish")}
        </button>
      )}
    </div>
  );
}
