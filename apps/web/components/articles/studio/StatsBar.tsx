"use client";

import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";

function Spinner({ size = 12 }: { size?: number }) {
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
  wordTarget?: number | null;
  seoScore: number | null;
  saveState: "idle" | "saving" | "saved";
}

/**
 * Inline stats cluster shown in the editor toolbar: live word count, reading
 * time, SEO score chip, and the autosave state. Actions (revision / publish /
 * save) live in the editor header.
 */
export function StatsBar({ wordCount, wordTarget, seoScore, saveState }: StatsBarProps) {
  const { t } = useTranslation();
  const readingMinutes = Math.ceil(wordCount / 200);
  const goalPct = wordTarget ? Math.min(100, Math.round((wordCount / wordTarget) * 100)) : null;

  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className="inline-flex flex-col gap-0.5 rounded-full bg-muted/60 px-2.5 py-1 text-muted-foreground tabular-nums"
        title={wordTarget ? t("articleStudio.goal", { count: wordTarget }) : undefined}
      >
        <span>{t("articleStudio.words", { count: wordCount })}</span>
        {goalPct !== null && (
          <span className="h-0.5 w-full overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full rounded-full transition-all ${goalPct >= 100 ? "bg-success" : "gradient-brand"}`}
              style={{ width: `${goalPct}%` }}
            />
          </span>
        )}
      </span>
      <span className="hidden items-center rounded-full bg-muted/60 px-2.5 py-1 text-muted-foreground tabular-nums sm:inline-flex">
        {t("articleStudio.readingTime", { min: readingMinutes })}
      </span>

      <span
        title={t("articles.editor.seoScore")}
        className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 transition-colors"
      >
        {seoScore !== null ? (
          <span className={`font-semibold tabular-nums ${seoColor(seoScore)}`}>SEO {seoScore}</span>
        ) : (
          <span className="text-muted-foreground">SEO</span>
        )}
      </span>

      {saveState === "saving" && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Spinner size={11} /> {t("articles.editor.saving")}
        </span>
      )}
      {saveState === "saved" && (
        <span className="flex items-center gap-1 text-emerald-500">
          <CheckCircle2 className="h-3.5 w-3.5" /> {t("articles.editor.saved")}
        </span>
      )}
    </div>
  );
}
