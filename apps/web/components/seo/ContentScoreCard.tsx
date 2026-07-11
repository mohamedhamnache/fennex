"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { FENNEX_AGENTS } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { scoreContent, ApiError, type ContentScore } from "@/lib/api";
import { ScoreResult } from "./ScoreResult";

type SourceTab = "url" | "text";

interface ContentScoreCardProps {
  projectId: string;
}

/**
 * SEO hub card — Dune scores a URL or pasted text against the live top 10
 * for a target keyword.
 */
export function ContentScoreCard({ projectId }: ContentScoreCardProps) {
  const { t } = useTranslation();
  const { warning: showWarning } = useToast();
  const dune = FENNEX_AGENTS.dune;

  const [keyword, setKeyword] = useState("");
  const [tab, setTab] = useState<SourceTab>("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<ContentScore | null>(null);

  const scoreMutation = useMutation({
    mutationFn: () =>
      scoreContent(projectId, keyword.trim(), tab === "url" ? { url: url.trim() } : { text: text.trim() }),
    onSuccess: (data) => setResult(data),
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        showWarning(t("seoHub.gate.title"), { message: t("seoHub.gate.body") });
      } else {
        showWarning(t("seoHub.score.title"), { message: t("common.error") });
      }
    },
  });

  const canSubmit =
    keyword.trim().length > 0 &&
    (tab === "url" ? url.trim().length > 0 : text.trim().length > 0) &&
    !scoreMutation.isPending;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg gradient-brand text-white">
          <dune.Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div>
          <h2 className="text-sm font-semibold text-foreground">{t("seoHub.score.title")}</h2>
          <p className="text-xs text-muted-foreground">{t("seoHub.score.subtitle")}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t("seoHub.score.keyword")}
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />

        <div className="flex gap-0 border-b border-border">
          {(["url", "text"] as const).map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              onClick={() => setTab(tabKey)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                tab === tabKey
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tabKey === "url" ? t("seoHub.score.byUrl") : t("seoHub.score.byText")}
            </button>
          ))}
        </div>

        {tab === "url" ? (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("seoHub.score.urlPlaceholder")}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("seoHub.score.textPlaceholder")}
            rows={5}
            className="w-full resize-none rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        )}

        <button
          type="button"
          onClick={() => scoreMutation.mutate()}
          disabled={!canSubmit}
          className="flex items-center justify-center gap-2 self-start rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {scoreMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("seoHub.score.analyze")}
        </button>
      </div>

      {result && (
        <div className="border-t border-border pt-4">
          <ScoreResult data={result} />
        </div>
      )}
    </Card>
  );
}
