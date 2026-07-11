"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2 } from "lucide-react";
import { addTrackedKeyword, getKeywordSuggestions, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

const MAX_KEYWORDS = 25;

interface AddKeywordBarProps {
  projectId: string;
  count: number;
}

export function AddKeywordBar({ projectId, count }: AddKeywordBarProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { error: showError } = useToast();
  const [keyword, setKeyword] = useState("");

  const atCap = count >= MAX_KEYWORDS;

  const { data: suggestions = [] } = useQuery({
    queryKey: ["seo-suggestions", projectId],
    queryFn: () => getKeywordSuggestions(projectId),
    staleTime: 60_000,
  });

  const addMutation = useMutation({
    mutationFn: (kw: string) => addTrackedKeyword(projectId, kw),
    onSuccess: () => {
      setKeyword("");
      queryClient.invalidateQueries({ queryKey: ["seo-keywords", projectId] });
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 400 || e.status === 409)) {
        showError(t("seoHub.add"), { message: e.message });
      } else {
        showError(t("seoHub.add"), { message: t("common.error") });
      }
    },
  });

  function handleAdd(kw: string) {
    const trimmed = kw.trim();
    if (!trimmed || atCap || addMutation.isPending) return;
    addMutation.mutate(trimmed);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd(keyword);
          }}
          placeholder={t("seoHub.addPlaceholder")}
          disabled={atCap}
          className="flex-1 rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
        />
        <button
          onClick={() => handleAdd(keyword)}
          disabled={atCap || !keyword.trim() || addMutation.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t("seoHub.add")}
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("seoHub.cap", { max: MAX_KEYWORDS })}</p>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">{t("seoHub.suggested")}</span>
          {suggestions.map((s) => (
            <button
              key={s.keyword}
              onClick={() => handleAdd(s.keyword)}
              disabled={atCap || addMutation.isPending}
              className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {s.keyword}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
