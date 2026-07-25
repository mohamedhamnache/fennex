"use client";

import { useTranslation } from "react-i18next";
import { ArrowRight, Clock, FileText, Search, Sparkles } from "lucide-react";
import { FennecMark } from "@fennex/ui";

const HINTS = [
  { key: "onboarding.welcome.hints.articles", icon: FileText },
  { key: "onboarding.welcome.hints.seo", icon: Search },
  { key: "onboarding.welcome.hints.brand", icon: Sparkles },
] as const;

export function WelcomeStep({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="text-center animate-fade-in">
      <FennecMark className="mx-auto h-12 w-12 animate-scale-in dark:brightness-0 dark:invert" />

      <h1 className="mt-6 font-display text-4xl font-bold tracking-tight text-foreground">
        {t("onboarding.welcome.title")}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-muted-foreground">{t("onboarding.welcome.subtitle")}</p>

      <span className="mx-auto mt-4 inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
        <Clock className="h-3.5 w-3.5" />
        {t("onboarding.welcome.time")}
      </span>

      <div className="mx-auto mt-8 grid max-w-lg grid-cols-1 gap-2.5 sm:grid-cols-3">
        {HINTS.map(({ key, icon: Icon }, i) => (
          <div
            key={key}
            style={{ animationDelay: `${i * 60}ms` }}
            className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-3 text-left animate-slide-up sm:flex-col sm:items-start sm:gap-2"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-xs font-medium text-foreground">{t(key)}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onStart}
        className="btn-primary mx-auto mt-9 flex cursor-pointer items-center gap-2 px-6 py-2.5 text-sm"
      >
        {t("onboarding.welcome.start")} <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}
