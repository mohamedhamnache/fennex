"use client";

import { useTranslation } from "react-i18next";
import type { DiscoveryResult } from "@/lib/api";
import { EditableField } from "./EditableField";

export function ReviewStep({ result, onChange, onNext }: {
  result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void;
}) {
  const { t } = useTranslation();
  const b = result.business;
  const set = (patch: Partial<DiscoveryResult["business"]>) =>
    onChange({ ...result, business: { ...b, ...patch } });

  return (
    <div className="animate-fade-in">
      <h2 className="font-display text-2xl font-bold text-foreground">{t("onboarding.review.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.review.subtitle")}</p>

      <div className="mt-6 space-y-4 rounded-xl border border-border bg-card p-5 animate-slide-up">
        <p className="text-sm font-semibold text-foreground">{t("onboarding.review.business")}</p>
        <div className="grid grid-cols-2 gap-3">
          <EditableField label={t("onboarding.review.name")} value={b.name} onChange={(v) => set({ name: v })} />
          <EditableField label={t("onboarding.review.industry")} value={b.industry} onChange={(v) => set({ industry: v })} />
          <EditableField label={t("onboarding.review.country")} value={b.country} onChange={(v) => set({ country: v })} />
          <EditableField label={t("onboarding.review.language")} value={b.language} onChange={(v) => set({ language: v })} />
        </div>
        <EditableField label={t("onboarding.review.description")} value={b.description} onChange={(v) => set({ description: v })} />
      </div>

      {result.brand.colors.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card p-5 animate-slide-up" style={{ animationDelay: "60ms" }}>
          <p className="text-sm font-semibold text-foreground">{t("onboarding.review.colors")}</p>
          <div className="mt-3 flex gap-2">
            {result.brand.colors.map((c) => (
              <span key={c} className="h-8 w-8 rounded-md border border-border" style={{ backgroundColor: c }} title={c} />
            ))}
          </div>
        </div>
      )}

      {result.competitors.length > 0 && (
        <div className="mt-4 rounded-xl border border-border bg-card p-5 animate-slide-up" style={{ animationDelay: "120ms" }}>
          <p className="text-sm font-semibold text-foreground">{t("onboarding.review.competitors")}</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {result.competitors.map((c, i) => <li key={i}>{c.name || c.url}</li>)}
          </ul>
        </div>
      )}

      <button onClick={onNext} className="btn-primary mt-6 px-6 py-2.5 text-sm">{t("onboarding.review.confirm")}</button>
    </div>
  );
}
