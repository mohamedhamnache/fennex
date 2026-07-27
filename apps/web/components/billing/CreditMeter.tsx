"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { Sparkles, Search } from "lucide-react";
import { getUsageSummary } from "@/lib/api";
import { cn } from "@/lib/cn";

type Bucket = { used: number; allowance: number };

function pctOf(bucket: Bucket) {
  return bucket.allowance > 0 ? bucket.used / bucket.allowance : 0;
}

function tone(pct: number) {
  if (pct >= 1) return "text-destructive";
  if (pct >= 0.8) return "text-warning";
  return "text-muted-foreground";
}

function Meter({ icon: Icon, label, bucket }: {
  icon: typeof Sparkles; label: string; bucket: Bucket;
}) {
  const pct = pctOf(bucket);
  const clamped = Math.min(Math.max(pct, 0), 1);
  return (
    <span
      className="flex items-center gap-1.5"
      title={`${label}: ${bucket.used.toLocaleString()}/${bucket.allowance.toLocaleString()}`}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", tone(pct))} strokeWidth={1.9} />
      <span className="hidden font-mono text-xs tabular-nums text-muted-foreground lg:block">
        {bucket.used.toLocaleString()}/{bucket.allowance.toLocaleString()}
      </span>
      <span aria-hidden className="hidden h-1 w-10 overflow-hidden rounded-full bg-muted lg:block">
        <span
          className={cn("block h-full rounded-full transition-all",
            pct >= 1 ? "bg-destructive" : pct >= 0.8 ? "bg-warning" : "bg-primary")}
          style={{ width: `${clamped * 100}%` }}
        />
      </span>
    </span>
  );
}

export function CreditMeter() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["usage-summary"],
    queryFn: getUsageSummary,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <span className="h-5 w-24 animate-pulse rounded bg-muted" />;
  if (isError || !data) return null;

  const ai: Bucket = { used: data.credits_used, allowance: data.credits_allowance };

  const hasSeo =
    data.seo_credits_used !== undefined &&
    data.seo_credits_allowance !== undefined;
  const seo: Bucket | null = hasSeo
    ? { used: data.seo_credits_used as number, allowance: data.seo_credits_allowance as number }
    : null;

  return (
    <Link
      href="/settings#billing"
      aria-label={t("credits.ariaLabel")}
      className="flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Meter icon={Sparkles} label={t("credits.ai")} bucket={ai} />
      {seo && <Meter icon={Search} label={t("credits.seo")} bucket={seo} />}
    </Link>
  );
}
