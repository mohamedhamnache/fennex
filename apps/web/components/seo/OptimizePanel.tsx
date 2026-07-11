"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, Loader2, RefreshCw } from "lucide-react";
import { FENNEX_AGENTS } from "@/lib/agents";
import { scoreContent, ApiError, type ContentScore } from "@/lib/api";
import { ScoreResult } from "./ScoreResult";

interface OptimizePanelProps {
  projectId: string;
  articleId: string;
  targetKeyword: string | null;
}

/**
 * Collapsible Optimize section in the article editor's right panel — Dune
 * scores the current article against the live top 10 for a target keyword.
 */
export function OptimizePanel({ projectId, articleId, targetKeyword }: OptimizePanelProps) {
  const { t } = useTranslation();
  const dune = FENNEX_AGENTS.dune;

  const [isOpen, setIsOpen] = useState(false);
  const [keyword, setKeyword] = useState(targetKeyword ?? "");
  const [result, setResult] = useState<ContentScore | null>(null);
  const [gateHit, setGateHit] = useState(false);

  const scoreMutation = useMutation({
    mutationFn: () => scoreContent(projectId, keyword.trim(), { articleId }),
    onSuccess: (data) => {
      setResult(data);
      setGateHit(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        setGateHit(true);
      }
    },
  });

  const canSubmit = keyword.trim().length > 0 && !scoreMutation.isPending;

  return (
    <div className="border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="mb-2 flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <dune.Icon className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} />
          {dune.name} · {t("seoHub.score.optimize")}
        </span>
        {isOpen ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {isOpen && (
        <div className="flex flex-col gap-2.5">
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder={t("seoHub.score.keyword")}
            className="w-full rounded-lg border border-border bg-input px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />

          <button
            type="button"
            onClick={() => scoreMutation.mutate()}
            disabled={!canSubmit}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            {scoreMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : result ? (
              <RefreshCw className="h-3.5 w-3.5" />
            ) : null}
            {result ? t("seoHub.score.rescore") : t("seoHub.score.analyze")}
          </button>

          {gateHit && (
            <p className="text-xs text-muted-foreground">{t("seoHub.gate.body")}</p>
          )}

          {result && <ScoreResult data={result} compact />}
        </div>
      )}
    </div>
  );
}
