"use client";

import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle, Globe } from "lucide-react";
import { ProgressRing } from "@/components/ui/ProgressRing";

interface MetaTabProps {
  articleTitle: string;
  targetKeyword: string | null;
  metaTitle: string;
  metaDesc: string;
  onMetaTitleChange: (val: string) => void;
  onMetaTitleBlur: () => void;
  onMetaDescChange: (val: string) => void;
  onMetaDescBlur: () => void;
  breakdown: Record<string, number>;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

/** Character-count meter: fills toward the ideal band, tone reflects status. */
function Meter({ len, min, max }: { len: number; min: number; max: number }) {
  const pct = Math.min(100, (len / max) * 100);
  const tone = len === 0 ? "bg-muted-foreground/30" : len >= min && len <= max ? "bg-success" : len > max ? "bg-destructive" : "bg-warning";
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/**
 * SEO / metadata panel: a live search-result preview, character-metered meta
 * title + description inputs, and the ranking-signal breakdown with a score.
 */
export function MetaTab({
  articleTitle,
  targetKeyword,
  metaTitle,
  metaDesc,
  onMetaTitleChange,
  onMetaTitleBlur,
  onMetaDescChange,
  onMetaDescBlur,
  breakdown,
}: MetaTabProps) {
  const { t } = useTranslation();

  const entries = Object.entries(breakdown);
  const scoreTotal = entries.reduce((s, [, v]) => s + v, 0);
  const previewTitle = metaTitle || articleTitle || t("articles.editor.metaTitlePlaceholder");
  const previewDesc = metaDesc || t("articles.editor.metaDescPlaceholder");
  const path = slug(targetKeyword || articleTitle || "");

  return (
    <div className="flex flex-col gap-5">
      {/* SEO score */}
      {entries.length > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card/40 p-3">
          <ProgressRing value={scoreTotal} size={64} stroke={6}>
            <span className="text-sm font-bold tabular-nums text-foreground">{Math.round(scoreTotal)}</span>
          </ProgressRing>
          <div>
            <p className="text-xs font-semibold text-foreground">{t("articleStudio.meta.seoScoreLabel")}</p>
            <p className="text-[11px] text-muted-foreground">{t("articleStudio.meta.signals")}</p>
          </div>
        </div>
      )}

      {/* Search preview */}
      <div className="flex flex-col gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          {t("articleStudio.meta.serpPreview")}
        </p>
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">yoursite.com{path ? ` › ${path}` : ""}</span>
          </div>
          <p className="mt-1 line-clamp-1 text-sm font-medium text-blue-400">{previewTitle}</p>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{previewDesc}</p>
        </div>
      </div>

      {/* Meta title */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">{t("articles.editor.metaTitle")}</label>
          <span className={`text-[10px] tabular-nums ${metaTitle.length >= 50 && metaTitle.length <= 60 ? "text-success" : metaTitle.length > 60 ? "text-destructive" : "text-muted-foreground"}`}>
            {metaTitle.length} / 60
          </span>
        </div>
        <input
          value={metaTitle}
          onChange={(e) => onMetaTitleChange(e.target.value)}
          onBlur={onMetaTitleBlur}
          placeholder={t("articles.editor.metaTitlePlaceholder")}
          className="w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <Meter len={metaTitle.length} min={50} max={60} />
        <p className="text-[10px] text-muted-foreground">{t("articleStudio.meta.metaTitleHint")}</p>
      </div>

      {/* Meta description */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-foreground">{t("articles.editor.metaDescription")}</label>
          <span className={`text-[10px] tabular-nums ${metaDesc.length >= 150 && metaDesc.length <= 160 ? "text-success" : metaDesc.length > 160 ? "text-destructive" : "text-muted-foreground"}`}>
            {metaDesc.length} / 160
          </span>
        </div>
        <textarea
          value={metaDesc}
          onChange={(e) => onMetaDescChange(e.target.value)}
          onBlur={onMetaDescBlur}
          placeholder={t("articles.editor.metaDescPlaceholder")}
          rows={4}
          className="w-full resize-none rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        <Meter len={metaDesc.length} min={150} max={160} />
        <p className="text-[10px] text-muted-foreground">{t("articleStudio.meta.metaDescHint")}</p>
      </div>

      {/* Ranking signals */}
      {entries.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {t("articleStudio.meta.signals")}
          </p>
          <div className="flex flex-col gap-1">
            {entries.map(([key, val]) => (
              <div key={key} className="flex items-center justify-between rounded-lg bg-muted/30 px-2.5 py-1.5 text-xs">
                <span className="flex items-center gap-1.5 text-foreground">
                  {val > 0 ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-destructive" />
                  )}
                  {t(`articleStudio.meta.signalNames.${key}`, { defaultValue: key.replace(/_/g, " ") })}
                </span>
                <span className={`tabular-nums font-semibold ${val > 0 ? "text-success" : "text-muted-foreground"}`}>
                  +{val}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
