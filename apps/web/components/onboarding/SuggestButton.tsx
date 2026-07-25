"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles, Loader2 } from "lucide-react";
import { suggestOnboarding, type SuggestField } from "@/lib/api";
import { cn } from "@/lib/cn";

/**
 * "Suggest with AI" affordance: asks the backend for more on-business items for
 * a discovery field and hands them to `onSuggest`. Renders nothing without a
 * runId (suggestions need a completed discovery run). Shows a transient "no
 * suggestions" state when the model returns nothing (e.g. no LLM key).
 */
export function SuggestButton<T>({
  runId,
  field,
  onSuggest,
  label,
  className,
}: {
  runId: string | null;
  field: SuggestField;
  onSuggest: (items: T[]) => void;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [empty, setEmpty] = useState(false);

  if (!runId) return null;

  async function run() {
    setLoading(true);
    setEmpty(false);
    try {
      const items = (await suggestOnboarding(runId as string, field)) as T[];
      if (items.length === 0) setEmpty(true);
      else onSuggest(items);
    } catch {
      setEmpty(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={loading}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        className,
      )}
    >
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Sparkles className="h-3.5 w-3.5" />
      )}
      {empty ? t("onboarding.suggest.none") : label ?? t("onboarding.suggest.label")}
    </button>
  );
}
