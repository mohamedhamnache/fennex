"use client";

import { useTranslation } from "react-i18next";
import type { DiscoveryResult } from "@/lib/api";
import { ChipMultiSelect } from "./ChipMultiSelect";

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
}: {
  result: DiscoveryResult;
  onChange: (r: DiscoveryResult) => void;
  onNext: () => void;
}) {
  const { t } = useTranslation();

  const toggle = (key: "goals" | "success_metrics", v: string) => {
    const cur = result[key];
    onChange({
      ...result,
      [key]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v],
    });
  };

  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-foreground">
        {t("onboarding.goals.title")}
      </h2>
      <p className="mt-4 mb-2 text-sm font-medium text-foreground">
        {t("onboarding.goals.goalsLabel")}
      </p>
      <ChipMultiSelect
        options={GOALS}
        selected={result.goals}
        onToggle={(v) => toggle("goals", v)}
      />
      <p className="mt-6 mb-2 text-sm font-medium text-foreground">
        {t("onboarding.goals.metricsLabel")}
      </p>
      <ChipMultiSelect
        options={METRICS}
        selected={result.success_metrics}
        onToggle={(v) => toggle("success_metrics", v)}
      />
      <button
        onClick={onNext}
        className="btn-primary mt-8 px-6 py-2.5 text-sm"
      >
        {t("onboarding.goals.next")}
      </button>
    </div>
  );
}
