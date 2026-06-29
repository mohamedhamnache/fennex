"use client";

import { X, Zap } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
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

const NEXT_TIER: Record<string, { name: string; priceId: string; price: number }> = {
  free: {
    name: "Starter",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_STARTER_MONTHLY ?? "",
    price: 49,
  },
  starter: {
    name: "Pro",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_PRO_MONTHLY ?? "",
    price: 99,
  },
  pro: {
    name: "Agency",
    priceId: process.env.NEXT_PUBLIC_STRIPE_PRICE_AGENCY_MONTHLY ?? "",
    price: 249,
  },
};

interface UpgradeModalProps {
  resource: string;
  used: number;
  limit: number;
  currentTier: string;
  onClose: () => void;
}

export function UpgradeModal({ resource, used, limit, currentTier, onClose }: UpgradeModalProps) {
  const next = NEXT_TIER[currentTier];
  const label = RESOURCE_LABELS[resource] ?? resource;

  const checkoutMutation = useMutation({
    mutationFn: () => {
      if (!next) return Promise.reject(new Error("No upgrade available"));
      return createCheckoutSession(
        next.priceId,
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

        <h2 className="font-display text-xl font-bold">Limit reached</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          You&apos;ve used <strong>{used}/{limit}</strong> {label} on your current plan.
          {next
            ? ` Upgrade to ${next.name} to keep going.`
            : " Contact us for Enterprise options."}
        </p>

        {next && (
          <div className="mt-6 flex flex-col gap-3">
            <button
              onClick={() => checkoutMutation.mutate()}
              disabled={checkoutMutation.isPending}
              className="btn-aurora w-full py-3 text-sm font-semibold"
            >
              {checkoutMutation.isPending
                ? "Redirecting…"
                : `Upgrade to ${next.name} — $${next.price}/mo →`}
            </button>
            <button
              onClick={onClose}
              className="w-full py-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Maybe later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
