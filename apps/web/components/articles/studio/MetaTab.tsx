"use client";

import { useTranslation } from "react-i18next";
import { CheckCircle2, XCircle } from "lucide-react";

interface MetaTabProps {
  metaTitle: string;
  metaDesc: string;
  onMetaTitleChange: (val: string) => void;
  onMetaTitleBlur: () => void;
  onMetaDescChange: (val: string) => void;
  onMetaDescBlur: () => void;
  breakdown: Record<string, number>;
}

/**
 * Moved from the article editor's right column: meta title / meta description
 * inputs and the SEO breakdown block. Same handlers, lifted from ArticleEditor —
 * no state duplication.
 */
export function MetaTab({
  metaTitle,
  metaDesc,
  onMetaTitleChange,
  onMetaTitleBlur,
  onMetaDescChange,
  onMetaDescBlur,
  breakdown,
}: MetaTabProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-5">
      {Object.keys(breakdown).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            {t("articles.editor.breakdown")}
          </p>
          <div className="flex flex-col gap-1.5">
            {Object.entries(breakdown).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-foreground capitalize">
                  {val > 0 ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5 text-red-400" />
                  )}
                  {key.replace(/_/g, " ")}
                </span>
                <span className={`tabular-nums font-medium ${val > 0 ? "text-emerald-500" : "text-red-400"}`}>
                  {val}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
          {t("articles.editor.metaTitle")}
        </label>
        <input
          value={metaTitle}
          onChange={(e) => onMetaTitleChange(e.target.value)}
          onBlur={onMetaTitleBlur}
          placeholder={t("articles.editor.metaTitlePlaceholder")}
          className="w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1.5">
          {t("articles.editor.metaDescription")}
          <span
            className={`ml-2 font-normal tabular-nums ${
              metaDesc.length >= 150 && metaDesc.length <= 160
                ? "text-emerald-500"
                : metaDesc.length > 160
                ? "text-red-400"
                : "text-muted-foreground"
            }`}
          >
            {metaDesc.length} / 160
          </span>
        </label>
        <textarea
          value={metaDesc}
          onChange={(e) => onMetaDescChange(e.target.value)}
          onBlur={onMetaDescBlur}
          placeholder={t("articles.editor.metaDescPlaceholder")}
          rows={4}
          className="w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
        />
      </div>
    </div>
  );
}
