"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { TrendingUp, TrendingDown, Search, FileText, Share2, ImagePlus, BarChart2, ShoppingBag, Compass, Swords, PenLine, Briefcase } from "lucide-react";
import { getPersonaHome, updateProject, type SecondaryMetric, type ProjectPersona } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const PERSONAS: { id: ProjectPersona; icon: React.ElementType }[] = [
  { id: "creator", icon: PenLine },
  { id: "ecommerce", icon: ShoppingBag },
  { id: "freelancer", icon: Briefcase },
];

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

export function PersonaHomeSection({ projectId, persona }: { projectId: string; persona: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["persona-home", projectId, persona],
    queryFn: () => getPersonaHome(projectId, persona),
    staleTime: 5 * 60_000,
  });

  async function switchPersona(next: ProjectPersona) {
    if (next === persona) return;
    await updateProject(projectId, { persona: next });
    try { localStorage.setItem("fx-analytics-persona", next); } catch { /* ignore */ }
    qc.invalidateQueries({ queryKey: ["projects"] });
  }

  const actions = QUICK_ACTIONS[persona] ?? QUICK_ACTIONS.creator;

  return (
    <div className="flex flex-col gap-4">
      {/* Persona banner: identity + goal + switcher + north-star + secondary */}
      <Card className="overflow-hidden border-primary/15 bg-gradient-to-br from-primary/[0.07] via-transparent to-transparent p-5 sm:p-6">
        {/* Identity + switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              {t(`personaHome.persona.${persona}`, { defaultValue: persona })}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(`personaHome.goal.${persona}`, { defaultValue: "" })}
            </p>
          </div>
          <div className="flex rounded-xl border border-border bg-card p-0.5">
            {PERSONAS.map((p) => {
              const active = p.id === persona;
              return (
                <button
                  key={p.id}
                  onClick={() => switchPersona(p.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                    active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <p.icon className="h-3.5 w-3.5" strokeWidth={2} />
                  <span className="hidden sm:inline">{t(`personaHome.persona.${p.id}`, { defaultValue: p.id })}</span>
                </button>
              );
            })}
          </div>
        </div>

        {isLoading ? (
          <div className="mt-5 h-14 w-64 animate-pulse rounded-lg bg-muted/40" />
        ) : data ? (
          <>
            {/* North-star + inline secondary */}
            <div className="mt-5 flex flex-wrap items-end gap-x-10 gap-y-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  {t(`personaHome.northStar.${data.north_star.key}`, { defaultValue: data.north_star.label })}
                </p>
                <div className="mt-0.5 flex items-end gap-2.5">
                  <span className="text-4xl font-bold leading-none tabular-nums text-foreground">
                    {fmt(data.north_star.value)}{data.north_star.unit}
                  </span>
                  {data.north_star.change !== null && (
                    <span className={cn(
                      "mb-0.5 flex items-center gap-1 text-sm font-semibold",
                      data.north_star.change >= 0 ? "text-success" : "text-destructive",
                    )}>
                      {data.north_star.change >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      {Math.abs(data.north_star.change).toFixed(0)}%
                    </span>
                  )}
                  {data.north_star.context && (
                    <span className="mb-1 text-sm text-muted-foreground">{data.north_star.context}</span>
                  )}
                </div>
              </div>

              {/* Secondary metrics inline */}
              <div className="flex flex-wrap gap-x-8 gap-y-3 border-l border-border/60 pl-8">
                {data.secondary.map((m: SecondaryMetric) => (
                  <div key={m.key}>
                    <p className="text-[11px] font-medium text-muted-foreground">
                      {t(`personaHome.secondary.${m.key}`, { defaultValue: m.label })}
                    </p>
                    <div className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="text-lg font-semibold tabular-nums text-foreground">
                        {m.unit === "%" ? m.value.toFixed(2) : fmt(m.value)}{m.unit}
                      </span>
                      {m.change !== null && (
                        <span className={cn(
                          "text-[11px] font-semibold",
                          (m.invert_change ? -m.change : m.change) >= 0 ? "text-success" : "text-destructive",
                        )}>
                          {m.change >= 0 ? "+" : ""}{m.change.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {data.north_star.value === 0 && (
              <Link href={`/${projectId}/analytics`} className="mt-3 inline-block text-xs font-medium text-primary hover:underline">
                {t("personaHome.connectGsc")}
              </Link>
            )}
          </>
        ) : (
          <p className="mt-5 text-sm text-muted-foreground">
            {t("personaHome.loadError", { defaultValue: "Couldn't load your dashboard metrics. Refresh to try again." })}
          </p>
        )}
      </Card>

      {/* Focus list + quick actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium text-foreground">
            {t(`personaHome.focus.${persona}`, { defaultValue: data?.focus.title ?? "" })}
          </h2>
          <Card className="divide-y">
            {!data || data.focus.items.length === 0 ? (
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
