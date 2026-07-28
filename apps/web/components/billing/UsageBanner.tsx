"use client";

import { useState } from "react";
import { X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUsageStore } from "@/lib/billing-store";
import { cn } from "@/lib/cn";

// Plain (non-i18n) labels -- see the note on RESOURCE_LABELS lookup below for
// why ai_credits/seo_credits are NOT added here.
const RESOURCE_LABELS: Record<string, string> = {
  articles: "articles",
  images: "images",
  social: "social posts",
  keywords: "keywords",
  brand_voices: "brand voices",
  audits: "audit runs",
  backlinks: "backlink analyses",
};

// ai_credits/seo_credits reuse the existing credits.ai/credits.seo i18n keys
// (already translated for every locale, shared with CreditMeter) rather than
// duplicating them as untranslated entries in RESOURCE_LABELS above.
const CREDIT_LABEL_KEYS: Record<string, string> = {
  ai_credits: "credits.ai",
  seo_credits: "credits.seo",
};

interface UsageBannerProps {
  onUpgrade: () => void;
}

export function UsageBanner({ onUpgrade }: UsageBannerProps) {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);
  const usage = useUsageStore((s) => s.usage);
  const warnResource = useUsageStore((s) => s.warnResource);

  if (dismissed || !usage) return null;

  const resource = warnResource();
  if (!resource) return null;

  const { used, limit, pct } = usage.usage[resource];
  const isAtLimit = pct >= 1.0;
  const label = CREDIT_LABEL_KEYS[resource]
    ? t(CREDIT_LABEL_KEYS[resource])
    : (RESOURCE_LABELS[resource] ?? resource);

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 px-6 py-2.5 text-sm",
        isAtLimit
          ? "bg-destructive/10 border-b border-destructive/20 text-destructive"
          : "bg-warning/10 border-b border-warning/20 text-warning",
      )}
    >
      <div className="flex items-center gap-2">
        <Zap className="h-3.5 w-3.5 shrink-0" />
        <span>
          {isAtLimit
            ? t("billing.atLimit", { label, used, limit })
            : t("billing.nearLimit", { used, limit, label })}
          {" "}
          <button onClick={onUpgrade} className="underline underline-offset-2 font-medium">
            {t("billing.upgradeToContinue")}
          </button>
        </span>
      </div>
      <button onClick={() => setDismissed(true)} className="shrink-0 opacity-60 hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
