"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowRight, Sparkles } from "lucide-react";
import { FENNEX_AGENTS, type AgentId } from "@/lib/agents";
import { PLAYBOOKS } from "@/lib/playbooks";
import type { ProjectPersona } from "@/lib/api";

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

/**
 * "Start a project" — proposes the right expert squad and an ordered tool plan
 * for the project's persona. The first concrete piece of the virtual-agency
 * experience: it turns "who you are" into "do these steps, with these agents".
 */
export function StartProjectPanel({ projectId, persona }: { projectId: string; persona: ProjectPersona }) {
  const { t } = useTranslation();
  const pb = PLAYBOOKS[persona] ?? PLAYBOOKS.creator;

  return (
    <div className="glass overflow-hidden rounded-2xl">
      <div className="relative border-b border-border p-5 sm:p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: "radial-gradient(560px 200px at 12% -30%, hsl(var(--primary) / 0.12), transparent 60%)" }}
        />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              {t("startProject.heading")}
            </p>
            <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-foreground">
              {t(pb.titleKey)}
            </h2>
            <p className="mt-0.5 max-w-xl text-sm text-muted-foreground">{t(pb.subtitleKey)}</p>
          </div>
          {/* Squad */}
          <div className="flex flex-col items-start gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {t("startProject.squad")}
            </span>
            <div className="flex -space-x-1.5">
              {pb.squad.map((id) => (
                <AgentAvatar key={id} id={id} size={32} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Steps */}
      <ol className="flex flex-col divide-y divide-border">
        {pb.steps.map((step, i) => {
          const agent = FENNEX_AGENTS[step.agent];
          return (
            <li key={i}>
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
                  <p className="truncate text-[11px] text-muted-foreground">{agent.name}</p>
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
