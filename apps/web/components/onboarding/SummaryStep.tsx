"use client";

import { useTranslation } from "react-i18next";
import { Pencil } from "lucide-react";
import type { DiscoveryResult } from "@/lib/api";
import type { OnboardingStep } from "./types";

export function SummaryStep({
  result,
  onEdit,
  onCreate,
}: {
  result: DiscoveryResult;
  onEdit: (step: OnboardingStep) => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation();

  const Row = ({ label, value, step }: { label: string; value: string; step: OnboardingStep }) => (
    <div className="flex items-center justify-between border-b border-border py-3 last:border-b-0">
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm text-foreground">{value || "-"}</p>
      </div>
      <button
        onClick={() => onEdit(step)}
        className="text-muted-foreground hover:text-primary"
        aria-label={t("onboarding.summary.edit", { field: label })}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div className="animate-fade-in">
      <h2 className="font-display text-2xl font-bold text-foreground">{t("onboarding.summary.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.summary.subtitle")}</p>

      <div className="mt-6 rounded-xl border border-border bg-card px-5 animate-slide-up">
        <Row label={t("onboarding.summary.business")} value={result.business.name ?? ""} step="review" />
        <Row label={t("onboarding.summary.goals")} value={result.goals.join(", ")} step="goals" />
        <Row label={t("onboarding.summary.brand")} value={result.brand.tone ?? ""} step="brand" />
        <Row
          label={t("onboarding.summary.audience")}
          value={result.audience.map((a) => a.label).filter(Boolean).join(", ")}
          step="audience"
        />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">{t("onboarding.summary.employeesNote")}</p>

      <button onClick={onCreate} className="btn-primary mt-6 px-6 py-2.5 text-sm">
        {t("onboarding.summary.create")}
      </button>
    </div>
  );
}
