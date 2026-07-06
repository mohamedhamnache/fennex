"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { TrendingUp, TrendingDown, Search, FileText, Share2, ImagePlus, BarChart2, ShoppingBag, Compass, Swords } from "lucide-react";
import { getPersonaHome, type SecondaryMetric } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const QUICK_ACTIONS: Record<string, { key: string; href: string; icon: React.ElementType }[]> = {
  creator: [
    { key: "keywords", href: "keywords", icon: Search },
    { key: "articles", href: "articles", icon: FileText },
    { key: "social", href: "social", icon: Share2 },
  ],
  ecommerce: [
    { key: "productStudio", href: "images", icon: ImagePlus },
    { key: "market", href: "analytics?ws=market", icon: ShoppingBag },
    { key: "analytics", href: "analytics", icon: BarChart2 },
  ],
  freelancer: [
    { key: "outreach", href: "agents/nomad", icon: Compass },
    { key: "marketReport", href: "analytics?ws=market&oasis=1", icon: FileText },
    { key: "competitor", href: "analytics?ws=competitors", icon: Swords },
  ],
};

function secondaryTone(i: number): "violet" | "emerald" | "amber" {
  return (["violet", "emerald", "amber"] as const)[i % 3];
}

export function PersonaHomeSection({ projectId, persona }: { projectId: string; persona: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useQuery({
    queryKey: ["persona-home", projectId, persona],
    queryFn: () => getPersonaHome(projectId, persona),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <div className="h-40 animate-pulse rounded-xl border bg-muted/30" />;
  if (!data) return null;

  const ns = data.north_star;
  const actions = QUICK_ACTIONS[persona] ?? QUICK_ACTIONS.creator;
  const noData = ns.value === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* North-star hero */}
      <Card className="p-5">
        <p className="text-xs font-medium text-muted-foreground">
          {t(`personaHome.northStar.${ns.key}`, { defaultValue: ns.label })}
        </p>
        <div className="mt-1 flex items-end gap-3">
          <span className="text-4xl font-bold tabular-nums text-foreground">{fmt(ns.value)}{ns.unit}</span>
          {ns.change !== null && (
            <span className={`mb-1 flex items-center gap-1 text-sm font-semibold ${ns.change >= 0 ? "text-success" : "text-destructive"}`}>
              {ns.change >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {Math.abs(ns.change).toFixed(0)}%
            </span>
          )}
          {ns.context && <span className="mb-1 text-sm text-muted-foreground">{ns.context}</span>}
        </div>
        {noData && (
          <Link href={`/${projectId}/analytics`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
            {t("personaHome.connectGsc")}
          </Link>
        )}
      </Card>

      {/* Secondary metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {data.secondary.map((m: SecondaryMetric, i) => (
          <StatCard
            key={m.key}
            label={t(`personaHome.secondary.${m.key}`, { defaultValue: m.label })}
            value={`${m.unit === "%" ? m.value.toFixed(2) : fmt(m.value)}${m.unit}`}
            change={m.change ?? undefined}
            invertChange={m.invert_change}
            tone={secondaryTone(i)}
            href={`/${projectId}/analytics`}
          />
        ))}
      </div>

      {/* Focus list + quick actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium text-foreground">
            {t(`personaHome.focus.${persona}`, { defaultValue: data.focus.title })}
          </h2>
          <Card className="divide-y">
            {data.focus.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">{t("personaHome.emptyFocus")}</p>
            ) : (
              data.focus.items.map((it, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="truncate text-sm font-medium text-foreground">{it.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{it.detail}</span>
                </div>
              ))
            )}
          </Card>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">{t("personaHome.quickActions")}</h2>
          <div className="flex flex-col gap-2">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={`/${projectId}/${a.href}`}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-primary/25 hover:bg-accent"
              >
                <a.icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.9} />
                {t(`personaHome.actions.${a.key}`)}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
