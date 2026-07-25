"use client";

import { useTranslation } from "react-i18next";
import type { DiscoveryResult } from "@/lib/api";
import { ChipMultiSelect } from "./ChipMultiSelect";
import { SuggestButton } from "./SuggestButton";

const GOALS = [
  "Increase SEO traffic",
  "Write blog posts",
  "Generate product pages",
  "Create Instagram content",
  "Grow Pinterest",
  "Generate leads",
  "Increase sales",
  "Launch products",
  "Email marketing",
  "Market research",
  "Competitor analysis",
];

const METRICS = [
  "Organic traffic",
  "Revenue",
  "Leads",
  "Followers",
  "Newsletter",
  "Sales",
  "Appointments",
];

export function GoalsStep({
  result,
  onChange,
  onNext,
  runId,
}: {
  result: DiscoveryResult;
  onChange: (r: DiscoveryResult) => void;
  onNext: () => void;
  runId: string | null;
}) {
  const { t } = useTranslation();

  const toggle = (key: "goals" | "success_metrics", v: string) => {
    const cur = result[key];
    onChange({
      ...result,
      [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
    });
  };

  // Merge AI-suggested goals in, de-duplicated and auto-selected.
  const addSuggestedGoals = (items: string[]) => {
    const merged = [...result.goals];
    for (const g of items) {
      const v = g.trim();
      if (v && !merged.some((x) => x.toLowerCase() === v.toLowerCase())) merged.push(v);
    }
    if (merged.length !== result.goals.length) onChange({ ...result, goals: merged });
  };

  // Options include any AI/discovered goals not in the built-in list, so custom
  // goals stay visible and toggleable as chips.
  const goalOptions = [...GOALS, ...result.goals.filter((g) => !GOALS.includes(g))];

  return (
    <div className="animate-fade-in">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-2xl font-bold text-foreground">
          {t("onboarding.goals.title")}
        </h2>
        <SuggestButton<string> runId={runId} field="goals" onSuggest={addSuggestedGoals} />
      </div>
      <div className="mt-6 animate-slide-up">
        <p className="mb-2 text-sm font-medium text-foreground">
          {t("onboarding.goals.goalsLabel")}
        </p>
        <ChipMultiSelect
          options={goalOptions}
          selected={result.goals}
          onToggle={(v) => toggle("goals", v)}
        />
      </div>
      <div className="mt-6 animate-slide-up" style={{ animationDelay: "60ms" }}>
        <p className="mb-2 text-sm font-medium text-foreground">
          {t("onboarding.goals.metricsLabel")}
        </p>
        <ChipMultiSelect
          options={METRICS}
          selected={result.success_metrics}
          onToggle={(v) => toggle("success_metrics", v)}
        />
      </div>
      <button
        onClick={onNext}
        className="btn-primary mt-8 px-6 py-2.5 text-sm"
      >
        {t("onboarding.goals.next")}
      </button>
    </div>
  );
}
