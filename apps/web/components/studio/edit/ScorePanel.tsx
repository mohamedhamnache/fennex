"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { BarChart2, ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";
import { scoreImage, getImageScore, type ImageScore } from "@/lib/api";

const DIMENSION_KEYS: (keyof ImageScore)[] = [
  "visual_quality", "brand_consistency", "seo_score", "ad_performance",
];

interface ScorePanelProps {
  imageId: string;
}

function ScoreBar({ value }: { value: number | null }) {
  const pct = value ?? 0;
  const color =
    pct >= 80 ? "bg-green-500" : pct >= 60 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground w-6 text-right">
        {value != null ? Math.round(value) : "—"}
      </span>
    </div>
  );
}

export function ScorePanel({ imageId }: ScorePanelProps) {
  const { t } = useTranslation();
  const { data: cached, refetch } = useQuery<ImageScore>({
    queryKey: ["image-score", imageId],
    queryFn: () => getImageScore(imageId),
    retry: false,
  });

  const [isOpen, setIsOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: () => scoreImage(imageId),
    onSuccess: () => { refetch(); setIsOpen(true); },
  });

  return (
    <div className="border-t border-border bg-card">
      {/* Header — always visible */}
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold text-foreground hover:text-primary transition-colors"
        >
          {isOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          <BarChart2 className="h-3.5 w-3.5 text-primary" />
          {t("imageEdit.score.title")}
          {cached?.overall != null && (
            <span className="ml-1 font-bold text-primary">
              {Math.round(cached.overall)}/100
            </span>
          )}
        </button>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3" strokeWidth={1.8} />
            )}
            {cached ? t("imageEdit.score.rescore") : t("imageEdit.score.scoreImage")}
          </button>
        </div>
      </div>

      {/* Expandable body */}
      {isOpen && (
        <div className="border-t border-border/60 px-4 py-3 flex flex-col gap-3">
          {cached && (
            <>
              <div className="flex flex-col gap-2">
                {DIMENSION_KEYS.map((key) => (
                  <div key={key} className="flex flex-col gap-1">
                    <span className="text-[10px] text-muted-foreground font-medium">
                      {t(`imageEdit.score.${key}`)}
                    </span>
                    <ScoreBar value={cached[key] as number | null} />
                  </div>
                ))}
              </div>

              {cached.feedback && (
                <p className="text-xs text-muted-foreground leading-relaxed border-t border-border/50 pt-2">
                  {cached.feedback}
                </p>
              )}
            </>
          )}

          {!cached && !mutation.isPending && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("imageEdit.score.hint")}
            </p>
          )}

          {mutation.isError && (
            <p className="text-xs text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : t("imageEdit.score.error")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
