"use client";
import { useTranslation } from "react-i18next";
import type { DiscoveryResult } from "@/lib/api";
import { EditableField } from "./EditableField";

export function BrandStep({ result, onChange, onNext }: {
  result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void;
}) {
  const { t } = useTranslation();
  const brand = result.brand;
  const set = (patch: Partial<DiscoveryResult["brand"]>) =>
    onChange({ ...result, brand: { ...brand, ...patch } });

  return (
    <div className="animate-fade-in">
      <h2 className="text-2xl font-bold text-foreground">{t("onboarding.brand.title")}</h2>
      <div className="mt-6 rounded-xl border border-border bg-card p-5 space-y-4">
        {brand.colors.length > 0 && (
          <div className="flex gap-2">
            {brand.colors.map((c) => (
              <span key={c} className="h-8 w-8 rounded-md border border-border" style={{ backgroundColor: c }} title={c} />
            ))}
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <EditableField label={t("onboarding.brand.tone")} value={brand.tone} onChange={(v) => set({ tone: v })} />
          <EditableField label={t("onboarding.brand.cta")} value={brand.cta_style} onChange={(v) => set({ cta_style: v })} />
          <EditableField label={t("onboarding.brand.reading")} value={brand.reading_level} onChange={(v) => set({ reading_level: v })} />
          <EditableField label={t("onboarding.brand.emoji")} value={brand.emoji_policy} onChange={(v) => set({ emoji_policy: v })} />
        </div>
        <EditableField label={t("onboarding.brand.mission")} value={brand.mission} onChange={(v) => set({ mission: v })} />
        <div>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t("onboarding.brand.voice")}</span>
          <textarea value={brand.voice_prompt ?? ""} rows={3} onChange={(e) => set({ voice_prompt: e.target.value })}
            className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none focus:border-primary/50" />
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {brand.vocabulary.length > 0 && <p><span className="font-medium text-foreground">{t("onboarding.brand.use")}:</span> {brand.vocabulary.join(", ")}</p>}
          {brand.avoid_words.length > 0 && <p><span className="font-medium text-foreground">{t("onboarding.brand.avoid")}:</span> {brand.avoid_words.join(", ")}</p>}
        </div>
      </div>
      <button onClick={onNext} className="btn-primary mt-6 px-6 py-2.5 text-sm">{t("onboarding.brand.next")}</button>
    </div>
  );
}
