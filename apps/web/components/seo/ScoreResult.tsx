"use client";

import { useTranslation } from "react-i18next";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { cn } from "@/lib/cn";
import type { ContentScore, ContentScoreTerm } from "@/lib/api";

const GROUP_ORDER: ContentScoreTerm["status"][] = ["missing", "underused", "present"];

const GROUP_CHIP_CLASS: Record<ContentScoreTerm["status"], string> = {
  missing: "border-destructive/30 bg-destructive/10 text-destructive",
  underused: "border-warning/30 bg-warning/10 text-warning",
  present: "border-success/30 bg-success/10 text-success",
};

interface ScoreResultProps {
  data: ContentScore;
  compact?: boolean;
}

/**
 * Shared content-score result view — used on the SEO hub's Content Optimizer
 * card and the article editor's Optimize panel.
 */
export function ScoreResult({ data, compact = false }: ScoreResultProps) {
  const { t } = useTranslation();

  const groups: Record<ContentScoreTerm["status"], ContentScoreTerm[]> = {
    missing: [],
    underused: [],
    present: [],
  };
  for (const term of data.terms) {
    groups[term.status].push(term);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <ProgressRing value={data.score} size={compact ? 84 : 132} stroke={compact ? 7 : 10}>
          <span className={cn("font-bold tabular-nums text-foreground", compact ? "text-xl" : "text-3xl")}>
            {Math.round(data.score)}
          </span>
          <span className="text-[11px] text-muted-foreground">{t("seoHub.score.of100")}</span>
        </ProgressRing>
        <div className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
          <p className="tabular-nums">
            {t("seoHub.score.words", {
              count: data.structure.word_count,
              target: data.structure.target_words,
            })}
          </p>
          <p className="tabular-nums">
            {t("seoHub.score.headings", {
              count: data.structure.headings,
              target: data.structure.target_headings,
            })}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {GROUP_ORDER.map((status) =>
          groups[status].length > 0 ? (
            <div key={status} className="flex flex-col gap-1.5">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t(`seoHub.score.${status}`)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {groups[status].map((term) => (
                  <span
                    key={term.term}
                    title={`${term.count}/${term.target}`}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium",
                      GROUP_CHIP_CLASS[status],
                    )}
                  >
                    {term.term}
                  </span>
                ))}
              </div>
            </div>
          ) : null,
        )}
      </div>

      {data.questions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {t("seoHub.score.questions")}
          </p>
          <ul className="flex flex-col gap-1 text-xs text-foreground">
            {data.questions.map((q, i) => (
              <li key={i} className="list-disc pl-4 marker:text-muted-foreground">
                {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.brief && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {t("seoHub.score.brief")}
          </p>
          <div className="flex flex-col gap-1 text-xs leading-relaxed text-foreground">
            {data.brief.split("\n").filter(Boolean).map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
