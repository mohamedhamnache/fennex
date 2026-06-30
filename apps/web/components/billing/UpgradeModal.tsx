"use client";

import { X, Zap } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { createCheckoutSession } from "@/lib/api";
import { cn } from "@/lib/cn";

const RESOURCE_LABELS: Record<string, string> = {
  articles: "articles",
  images: "images",
  social: "social posts",
  keywords: "keywords tracked",
  brand_voices: "brand voices",
  audits: "audit runs",
  backlinks: "backlink analyses",
};

const NEXT_TIER: Record<string, { name: string; tier: string; price: number }> = {
  free:    { name: "Starter", tier: "starter", price: 49 },
  starter: { name: "Pro",     tier: "pro",     price: 99 },
  pro:     { name: "Agency",  tier: "agency",  price: 249 },
};

interface UpgradeModalProps {
  resource: string;
  used: number;
  limit: number;
  currentTier: string;
  onClose: () => void;
}

export function UpgradeModal({ resource, used, limit, currentTier, onClose }: UpgradeModalProps) {
  const { t } = useTranslation();
  const next = NEXT_TIER[currentTier];
  const label = RESOURCE_LABELS[resource] ?? resource;

  const checkoutMutation = useMutation({
    mutationFn: () => {
      if (!next) return Promise.reject(new Error("No upgrade available"));
      return createCheckoutSession(
        next.tier,
        false,
        `${window.location.origin}/settings?billing=success`,
        window.location.href,
      );
    },
    onSuccess: ({ checkout_url }) => {
      window.location.href = checkout_url;
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={cn("glass w-full max-w-md rounded-2xl p-8 shadow-lg relative")}>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex h-12 w-12 items-center justify-center rounded-2xl gradient-brand mb-5">
          <Zap className="h-5 w-5 text-white" />
        </div>

        <h2 className="font-display text-xl font-bold">{t("billing.limitReached")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("billing.limitUsed", { used, limit, label })}
          {" "}
          {next
            ? t("billing.upgradeTo", { name: next.name })
            : t("billing.contactEnterprise")}
        </p>

        {next && (
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending}
              className="btn-aurora w-full py-3 text-sm font-semibold"
            >
              {checkoutMutation.isPending
                ? t("billing.redirecting")
                : t("billing.upgradeCta", { name: next.name, price: next.price })}
            </button>
            <button
              onClick={onClose}
              className="w-full py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              {t("billing.maybeLater")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
