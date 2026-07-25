"use client";

import { useTranslation } from "react-i18next";
import { ArrowRight } from "lucide-react";

export function WelcomeStep({ onStart }: { onStart: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="text-center animate-fade-in">
      <h1 className="text-3xl font-bold text-foreground">{t("onboarding.welcome.title")}</h1>
      <p className="mt-3 text-muted-foreground">{t("onboarding.welcome.subtitle")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("onboarding.welcome.time")}</p>
      <button onClick={onStart} className="btn-primary mx-auto mt-8 flex items-center gap-2 px-6 py-2.5 text-sm">
        {t("onboarding.welcome.start")} <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}
