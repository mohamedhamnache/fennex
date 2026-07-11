"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { FENNEX_AGENTS } from "@/lib/agents";

/**
 * Hero gate shown when the org has no SEO data provider connected yet.
 * Rank tracking runs on the user's own DataForSEO account (pay-per-use).
 */
export function ProviderGate() {
  const { t } = useTranslation();
  const zerda = FENNEX_AGENTS.zerda;

  return (
    <Card className="flex flex-col items-center gap-4 p-10 text-center">
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full gradient-brand text-white glow-primary">
        <zerda.Icon className="h-8 w-8" strokeWidth={1.8} />
      </span>
      <div className="max-w-md">
        <h2 className="text-lg font-bold text-foreground">{t("seoHub.gate.title")}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("seoHub.gate.body")}</p>
      </div>
      <Link
        href="/settings"
        className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {t("seoHub.gate.cta")}
      </Link>
    </Card>
  );
}
