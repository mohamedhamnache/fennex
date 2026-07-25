"use client";

import { useTranslation } from "react-i18next";
import { Plus, Trash2, X, Sparkles } from "lucide-react";
import type { DiscoveryCompetitor, DiscoveryResult } from "@/lib/api";
import { cn } from "@/lib/cn";
import { EditableField } from "./EditableField";
import { SuggestButton } from "./SuggestButton";

export function ReviewStep({ result, onChange, onNext, runId }: {
  result: DiscoveryResult; onChange: (r: DiscoveryResult) => void; onNext: () => void; runId: string | null;
}) {
  const { t } = useTranslation();
  const b = result.business;
  const set = (patch: Partial<DiscoveryResult["business"]>) =>
    onChange({ ...result, business: { ...b, ...patch } });

  // The "it understands me" moment: a warm, specific read-back of what Fennex
  // learned, built from the discovered profile. Only shown once we have enough
  // to say something real.
  const understanding = b.description?.trim()
    || [b.name, b.industry].filter(Boolean).join(" — ") || "";

  const appendCompetitors = (items: DiscoveryCompetitor[]) => {
    const seen = new Set(
      result.competitors.map((c) => (c.name || c.url || "").trim().toLowerCase()),
    );
    const fresh = items.filter((c) => {
      const id = (c.name || c.url || "").trim().toLowerCase();
      return id && !seen.has(id);
    });
    if (fresh.length) onChange({ ...result, competitors: [...result.competitors, ...fresh] });
  };

  const seo = result.seo;
  const removeKeyword = (i: number) =>
    onChange({
      ...result,
      seo: { ...seo, suggested_keywords: seo.suggested_keywords.filter((_, idx) => idx !== i) },
    });
  const hasSeo =
    seo.score != null || seo.suggested_keywords.length > 0 || seo.issues.length > 0;
  const scoreTone =
    seo.score == null
      ? "bg-muted text-muted-foreground"
      : seo.score >= 70
        ? "bg-primary/15 text-primary"
        : seo.score >= 40
          ? "bg-muted text-foreground"
          : "bg-destructive/15 text-destructive";

  const setColor = (i: number, v: string) => {
    const colors = result.brand.colors.map((c, idx) => (idx === i ? v : c));
    onChange({ ...result, brand: { ...result.brand, colors } });
  };
  const addColor = () =>
    onChange({ ...result, brand: { ...result.brand, colors: [...result.brand.colors, "#000000"] } });
  const removeColor = (i: number) => {
    const colors = result.brand.colors.filter((_, idx) => idx !== i);
    onChange({ ...result, brand: { ...result.brand, colors } });
  };

  const setCompetitor = (i: number, patch: Partial<DiscoveryCompetitor>) => {
    const competitors = result.competitors.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    onChange({ ...result, competitors });
  };
  const addCompetitor = () =>
    onChange({ ...result, competitors: [...result.competitors, { name: "", url: "" }] });
  const removeCompetitor = (i: number) =>
    onChange({ ...result, competitors: result.competitors.filter((_, idx) => idx !== i) });

  return (
    <div className="animate-fade-in">
      <h2 className="font-display text-2xl font-bold text-foreground">{t("onboarding.review.title")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("onboarding.review.subtitle")}</p>

      {understanding && (
        <div className="mt-5 flex gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 animate-slide-up">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">
              {t("onboarding.review.understandTitle")}
            </p>
            <p className="mt-1 text-sm text-foreground">{understanding}</p>
          </div>
        </div>
      )}

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

      <div className="mt-4 rounded-xl border border-border bg-card p-5 animate-slide-up" style={{ animationDelay: "60ms" }}>
        <p className="text-sm font-semibold text-foreground">{t("onboarding.review.colors")}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {result.brand.colors.map((c, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5">
              <span
                className="h-6 w-6 shrink-0 rounded-md border border-border"
                style={{ backgroundColor: c }}
                aria-hidden
              />
              <input
                value={c}
                onChange={(e) => setColor(i, e.target.value)}
                aria-label={t("onboarding.review.colorLabel", { index: i + 1 })}
                className="w-[76px] bg-transparent text-xs text-foreground outline-none"
              />
              <button
                onClick={() => removeColor(i)}
                aria-label={t("onboarding.review.removeColor")}
                className="text-muted-foreground transition-colors hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={addColor}
            className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" /> {t("onboarding.review.addColor")}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card p-5 animate-slide-up" style={{ animationDelay: "120ms" }}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">{t("onboarding.review.competitors")}</p>
          <SuggestButton<DiscoveryCompetitor> runId={runId} field="competitors" onSuggest={appendCompetitors} />
        </div>
        <div className="mt-3 space-y-3">
          {result.competitors.map((c, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg border border-border bg-background p-3">
              <div className="grid flex-1 grid-cols-2 gap-3">
                <EditableField
                  label={t("onboarding.review.competitorName")}
                  value={c.name ?? ""}
                  onChange={(v) => setCompetitor(i, { name: v })}
                />
                <EditableField
                  label={t("onboarding.review.competitorUrl")}
                  value={c.url ?? ""}
                  onChange={(v) => setCompetitor(i, { url: v })}
                />
              </div>
              <button
                onClick={() => removeCompetitor(i)}
                aria-label={t("onboarding.review.removeCompetitor")}
                className="mt-4 shrink-0 text-muted-foreground transition-colors hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <button
            onClick={addCompetitor}
            className="flex items-center gap-2 rounded-lg border border-dashed border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="h-4 w-4" /> {t("onboarding.review.addCompetitor")}
          </button>
        </div>
      </div>

      {hasSeo && (
        <div className="mt-4 rounded-xl border border-border bg-card p-5 animate-slide-up" style={{ animationDelay: "180ms" }}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-foreground">{t("onboarding.review.seo")}</p>
            {seo.score != null && (
              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-bold", scoreTone)}>
                {t("onboarding.review.seoScore", { score: seo.score })}
              </span>
            )}
          </div>
          {seo.word_count != null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("onboarding.review.seoWords", { count: seo.word_count })}
            </p>
          )}
          {seo.suggested_keywords.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("onboarding.review.seoKeywords")}</p>
              <div className="flex flex-wrap gap-1.5">
                {seo.suggested_keywords.map((kw, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                    {kw}
                    <button
                      onClick={() => removeKeyword(i)}
                      aria-label={t("onboarding.review.removeKeyword")}
                      className="text-primary/60 transition-colors hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {seo.issues.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t("onboarding.review.seoIssues")}</p>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                {seo.issues.map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <button onClick={onNext} className="btn-primary mt-6 px-6 py-2.5 text-sm">{t("onboarding.review.confirm")}</button>
    </div>
  );
}
