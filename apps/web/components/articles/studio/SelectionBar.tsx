"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Wand2 } from "lucide-react";
import { transformText, type TransformMode } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

const MAX_SELECTION_LENGTH = 6000;

const MODES: TransformMode[] = ["rephrase", "simplify", "expand", "shorten", "humanize"];

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

interface Suggestion {
  mode: TransformMode;
  original: string;
  text: string;
  start: number;
  end: number;
}

interface SelectionBarProps {
  articleId: string;
  selection: { start: number; end: number } | null;
  body: string;
  onBodyChange: (val: string) => void;
  onRestoreFocus: () => void;
}

/**
 * Selection-aware rewrite bar shown above the editor. Tracks the current
 * textarea selection (passed in from the editor) and offers 5 transform
 * chips; a chip click calls Dune's transform endpoint and renders a
 * compare card (original vs suggestion) with Replace/Discard actions.
 */
export function SelectionBar({
  articleId,
  selection,
  body,
  onBodyChange,
  onRestoreFocus,
}: SelectionBarProps) {
  const { t } = useTranslation();
  const { error: toastError } = useToast();
  const [loadingMode, setLoadingMode] = useState<TransformMode | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);

  const hasSelection = !!selection && selection.end > selection.start;
  const selectedText = hasSelection ? body.slice(selection!.start, selection!.end) : "";
  const tooLong = selectedText.length > MAX_SELECTION_LENGTH;
  const disabled = !hasSelection || tooLong;

  // Clear the pending suggestion when the user makes a genuinely new,
  // non-empty selection (different range from the one the suggestion was
  // captured against). Caret-only / empty selection changes must NOT clear
  // the card — that's what fires right after Replace/Discard restores focus.
  useEffect(() => {
    if (!suggestion) return;
    if (!selection) return;
    if (selection.start !== suggestion.start || selection.end !== suggestion.end) {
      setSuggestion(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  async function handleChipClick(mode: TransformMode) {
    if (disabled || !selection || loadingMode) return;
    setLoadingMode(mode);
    setSuggestion(null);
    try {
      const result = await transformText(articleId, mode, selectedText);
      setSuggestion({
        mode,
        original: selectedText,
        text: result.text,
        start: selection.start,
        end: selection.end,
      });
    } catch (e) {
      toastError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingMode(null);
    }
  }

  function handleReplace() {
    if (!suggestion) return;
    const { start, end, original, text } = suggestion;

    if (body.slice(start, end) === original) {
      onBodyChange(body.slice(0, start) + text + body.slice(end));
      setSuggestion(null);
      onRestoreFocus();
      return;
    }

    // Body changed since the transform was requested — the snapshot range
    // no longer matches. Fall back to replacing the first occurrence of the
    // original text rather than splicing at now-stale indices.
    const fallbackIndex = body.indexOf(original);
    if (fallbackIndex !== -1) {
      onBodyChange(
        body.slice(0, fallbackIndex) + text + body.slice(fallbackIndex + original.length),
      );
      setSuggestion(null);
      onRestoreFocus();
      return;
    }

    toastError(t("articleStudio.selection.stale"));
    setSuggestion(null);
    onRestoreFocus();
  }

  function handleDiscard() {
    setSuggestion(null);
    onRestoreFocus();
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border px-5 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {MODES.map((mode) => (
          <button
            key={mode}
            onClick={() => handleChipClick(mode)}
            disabled={disabled || !!loadingMode}
            title={disabled ? (tooLong ? t("articleStudio.selection.tooLong") : t("articleStudio.selection.hint")) : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              mode === "humanize"
                ? "border-primary/40 text-primary hover:bg-primary/10"
                : "border-border text-foreground hover:bg-accent"
            }`}
          >
            {loadingMode === mode ? <Spinner size={12} /> : <Wand2 className="h-3 w-3" />}
            {t(`articleStudio.selection.${mode}`)}
          </button>
        ))}

        {disabled && (
          <span className="text-xs text-muted-foreground">
            {tooLong ? t("articleStudio.selection.tooLong") : t("articleStudio.selection.hint")}
          </span>
        )}
      </div>

      {suggestion && (
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex flex-col gap-1.5 rounded-lg bg-muted/60 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("articleStudio.selection.original")}
            </p>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{suggestion.original}</p>
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-primary/40 bg-card p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              {t("articleStudio.selection.suggestion")}
            </p>
            <p className="text-sm text-foreground whitespace-pre-wrap">{suggestion.text}</p>
          </div>
          <div className="col-span-2 flex justify-end gap-2">
            <button
              onClick={handleDiscard}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
            >
              {t("articleStudio.selection.discard")}
            </button>
            <button
              onClick={handleReplace}
              className="btn-primary px-3 py-1.5 text-xs"
            >
              {t("articleStudio.selection.replace")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
