"use client";

import { useTranslation } from "react-i18next";
import { CheckCircle2, Type, Clock } from "lucide-react";
import { cn } from "@/lib/cn";

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

// Score band → chip classes (dot + tinted background). Colour is paired with a
// text label ("SEO 86") so meaning never rests on colour alone.
function seoBand(score: number | null): string {
  if (score === null) return "bg-muted/60 text-muted-foreground";
  if (score >= 80) return "bg-emerald-500/12 text-emerald-500";
  if (score >= 60) return "bg-amber-500/12 text-amber-500";
  return "bg-red-500/12 text-red-500";
}

function geoBand(score: number | null): string {
  if (score === null) return "bg-muted/60 text-muted-foreground";
  if (score >= 50) return "bg-emerald-500/12 text-emerald-500";
  if (score >= 35) return "bg-amber-500/12 text-amber-500";
  return "bg-red-500/12 text-red-500";
}

function ScoreChip({ label, score, band, title }: { label: string; score: number | null; band: string; title: string }) {
  return (
    <span
      title={title}
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold tabular-nums", band)}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", score === null ? "bg-current opacity-40" : "bg-current")} />
      {score !== null ? `${label} ${score}` : label}
    </span>
  );
}

interface StatsBarProps {
  wordCount: number;
  wordTarget?: number | null;
  seoScore: number | null;
  geoScore: number | null;
  saveState: "idle" | "saving" | "saved";
}

/**
 * Inline stats cluster shown in the editor toolbar: live word count with an
 * optional goal meter, reading time, SEO/GEO score chips, and the autosave
 * state. Actions (revision / publish / save) live in the editor header.
 */
export function StatsBar({ wordCount, wordTarget, seoScore, geoScore, saveState }: StatsBarProps) {
  const { t } = useTranslation();
  const readingMinutes = Math.ceil(wordCount / 200);
  const goalPct = wordTarget ? Math.min(100, Math.round((wordCount / wordTarget) * 100)) : null;
  const goalMet = goalPct !== null && goalPct >= 100;

  return (
    <div className="flex items-center gap-2 text-xs">
      {/* Word count (+ goal meter) */}
      <span
        className="inline-flex items-center gap-2 rounded-full bg-muted/60 px-2.5 py-1 text-muted-foreground tabular-nums"
        title={wordTarget ? t("articleStudio.goal", { count: wordTarget }) : undefined}
      >
        <Type className="h-3 w-3 shrink-0" />
        <span className={goalMet ? "font-semibold text-success" : undefined}>
          {t("articleStudio.words", { count: wordCount })}
        </span>
        {goalPct !== null && (
          <span className="h-1 w-10 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span
              className={cn("block h-full rounded-full transition-all", goalMet ? "bg-success" : "gradient-brand")}
              style={{ width: `${goalPct}%` }}
            />
          </span>
        )}
      </span>

      {/* Reading time */}
      <span className="hidden items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-muted-foreground tabular-nums sm:inline-flex">
        <Clock className="h-3 w-3 shrink-0" />
        {t("articleStudio.readingTime", { min: readingMinutes })}
      </span>

      {/* Scores */}
      <ScoreChip label="SEO" score={seoScore} band={seoBand(seoScore)} title={t("articles.editor.seoScore")} />
      <ScoreChip label="GEO" score={geoScore} band={geoBand(geoScore)} title={t("articles.editor.geoScore")} />

      {/* Autosave state */}
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
