"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, Image as ImageIcon, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { suggestImagesForArticle, generateImage, type ImageSuggestion } from "@/lib/api";

const PLACEMENT_LABELS: Record<string, string> = {
  hero: "Hero",
  body: "Body",
  sidebar: "Sidebar",
};

interface ImageSuggestionsPanelProps {
  articleId: string;
  projectId: string;
}

export function ImageSuggestionsPanel({ articleId, projectId }: ImageSuggestionsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<ImageSuggestion[]>([]);
  const [generatingIdx, setGeneratingIdx] = useState<number | null>(null);
  const [generatedIdxs, setGeneratedIdxs] = useState<Set<number>>(new Set());

  const analyzeMutation = useMutation({
    mutationFn: () => suggestImagesForArticle(articleId),
    onSuccess: (data) => {
      setSuggestions(data);
      setGeneratedIdxs(new Set());
      setIsOpen(true);
    },
  });

  async function handleGenerate(suggestion: ImageSuggestion, idx: number) {
    setGeneratingIdx(idx);
    try {
      await generateImage({
        project_id: projectId,
        prompt: suggestion.suggested_prompt,
        usage: "article_cover",
        article_id: articleId,
      });
      setGeneratedIdxs((prev) => new Set([...prev, idx]));
    } finally {
      setGeneratingIdx(null);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold text-foreground hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          Image Suggestions
          {suggestions.length > 0 && (
            <span className="rounded-full bg-primary/10 text-primary text-xs font-medium px-1.5 py-0.5">
              {suggestions.length}
            </span>
          )}
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {isOpen && (
        <div className="border-t border-border p-4 flex flex-col gap-3">
          <button
            type="button"
            disabled={analyzeMutation.isPending}
            onClick={() => analyzeMutation.mutate()}
            className="flex items-center gap-2 self-start rounded-lg bg-primary/10 border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
          >
            {analyzeMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            {analyzeMutation.isPending
              ? "Analyzing…"
              : suggestions.length > 0
              ? "Re-analyze"
              : "Analyze article"}
          </button>

          {analyzeMutation.isError && (
            <p className="text-xs text-destructive">
              Analysis failed — ensure an AI key is configured in Settings.
            </p>
          )}

          {suggestions.map((s, i) => (
            <div key={i} className="rounded-lg border border-border bg-muted/20 p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span
                  className={cn(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    s.placement === "hero"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {PLACEMENT_LABELS[s.placement] ?? s.placement}
                </span>
                <p className="text-xs text-muted-foreground leading-snug flex-1">{s.section_hint}</p>
              </div>
              <p className="text-xs font-medium text-foreground">{s.image_concept}</p>
              <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
                {s.suggested_prompt}
              </p>
              <button
                type="button"
                disabled={generatingIdx === i}
                onClick={() => handleGenerate(s, i)}
                className={cn(
                  "flex items-center gap-1.5 self-start rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
                  generatedIdxs.has(i)
                    ? "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400"
                    : "border-border text-foreground hover:bg-accent",
                )}
              >
                {generatingIdx === i ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ImageIcon className="h-3 w-3" />
                )}
                {generatingIdx === i
                  ? "Generating…"
                  : generatedIdxs.has(i)
                  ? "Generated ✓"
                  : "Generate"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
