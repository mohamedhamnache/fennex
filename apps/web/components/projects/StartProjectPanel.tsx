"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, Sparkles, Target } from "lucide-react";
import { FENNEX_AGENTS, type AgentId } from "@/lib/agents";
import { PERSONA_GOALS } from "@/lib/playbooks";
import { getPlanGrounding, type PlanHint, type ProjectPersona } from "@/lib/api";
import { cn } from "@/lib/cn";

const AGENT_GRADIENT: Record<AgentId, string> = {
  zerda: "from-indigo-500 to-violet-500",
  sirocco: "from-violet-500 to-fuchsia-500",
  dune: "from-blue-500 to-indigo-500",
  mirage: "from-fuchsia-500 to-pink-500",
  sable: "from-slate-600 to-indigo-600",
  oasis: "from-emerald-500 to-teal-500",
  nomad: "from-amber-500 to-orange-500",
};

function AgentAvatar({ id, size = 30 }: { id: AgentId; size?: number }) {
  const a = FENNEX_AGENTS[id];
  return (
    <span
      className={`flex items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm ${AGENT_GRADIENT[id]}`}
      style={{ height: size, width: size }}
      title={`${a.name} — ${a.role}`}
    >
      <a.Icon style={{ height: size * 0.5, width: size * 0.5 }} strokeWidth={1.9} />
    </span>
  );
}

/** Map a step route to the grounding capability whose hint applies to it. */
function capabilityFor(route: string): string | null {
  if (route.includes("competitors")) return "competitors";
  if (route.startsWith("keywords") || route.startsWith("seo")) return "keywords";
  if (route.startsWith("articles")) return "articles";
  if (route.startsWith("social") || route.startsWith("images") || route.startsWith("campaigns")) return "social";
  return null;
}

/** Format a grounding hint's numbers into i18n interpolation values. */
function hintValues(h: PlanHint, locale: string): Record<string, string> {
  const num = (n: number) => new Intl.NumberFormat(locale).format(Math.round(n));
  switch (h.key) {
    case "keywords": return { query: h.query, pos: h.a.toFixed(1), clicks: num(h.b) };
    case "articles": return { query: h.query, impressions: num(h.a) };
    case "social": return { query: h.query, count: num(h.a) };
    case "competitors": return { query: h.query, pos: h.a.toFixed(1) };
    default: return { query: h.query };
  }
}

/**
 * "Start a project" — proposes the right expert squad and an ordered tool plan
 * for the project's persona. The persona offers a few concrete goals; picking
 * one swaps in its tailored squad and step-by-step plan. The first concrete
 * piece of the virtual-agency experience: it turns "who you are" and "what you
 * want" into "do these steps, with these agents".
 */
export function StartProjectPanel({ projectId, persona }: { projectId: string; persona: ProjectPersona }) {
  const { t, i18n } = useTranslation();
  const goals = PERSONA_GOALS[persona] ?? PERSONA_GOALS.creator;
  const [active, setActive] = useState(0);
  const goal = goals[active] ?? goals[0];

  const { data: grounding } = useQuery({
    queryKey: ["plan-grounding", projectId],
    queryFn: () => getPlanGrounding(projectId),
    staleTime: 5 * 60_000,
  });
  const hintByKey = new Map((grounding?.hints ?? []).map((h) => [h.key, h]));

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="relative border-b border-border p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: "radial-gradient(560px 200px at 12% -30%, hsl(var(--primary) / 0.12), transparent 60%)" }}
        />
        <div className="relative flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                {t("startProject.heading")}
              </p>
              <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-foreground">
                {t(goal.titleKey)}
              </h2>
              <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">{t(goal.subtitleKey)}</p>
            </div>
            {/* Squad */}
            <div className="flex flex-col items-start gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {t("startProject.squad")}
              </span>
              <div className="flex -space-x-1.5">
                {goal.squad.map((id) => (
                  <AgentAvatar key={id} id={id} size={32} />
                ))}
              </div>
            </div>
          </div>

          {/* Goal picker */}
          {goals.length > 1 && (
            <div className="flex flex-wrap gap-2">
              <span className="sr-only">{t("startProject.pickGoal")}</span>
              {goals.map((g, i) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setActive(i)}
                  aria-pressed={i === active}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    i === active
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-white/[0.03] hover:text-foreground",
                  )}
                >
                  {t(g.titleKey)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Steps */}
      <ol className="flex flex-col divide-y divide-border">
        {goal.steps.map((step, i) => {
          const agent = FENNEX_AGENTS[step.agent];
          const cap = capabilityFor(step.route);
          const hint = cap ? hintByKey.get(cap) : undefined;
          return (
            <li key={`${goal.id}-${i}`}>
              <Link
                href={`/${projectId}/${step.route}`}
                className="group flex items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-white/[0.03]"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <AgentAvatar id={step.agent} size={30} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                    {t(step.labelKey)}
                  </p>
                  {hint ? (
                    <p className="flex items-center gap-1 truncate text-[11px] text-primary/90">
                      <Target className="h-3 w-3 shrink-0" strokeWidth={2} />
                      <span className="truncate">{t(`startProject.grounding.${hint.key}`, hintValues(hint, i18n.language))}</span>
                    </p>
                  ) : (
                    <p className="truncate text-[11px] text-muted-foreground">{agent.name}</p>
                  )}
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/40 transition-all group-hover:translate-x-0.5 group-hover:text-primary" />
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
