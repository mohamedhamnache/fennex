"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ArrowRight, Check, Sparkles, Lock, Megaphone } from "lucide-react";
import { listProjects } from "@/lib/api";
import { FENNEX_AGENTS, UPCOMING_AGENTS, type FennexAgent } from "@/lib/agents";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

interface AgentAction {
  key: string;
  href: string;
}

function agentActions(agentId: string, base: string): AgentAction[] {
  switch (agentId) {
    case "zerda":
      return [
        { key: "askZerda", href: `${base}/analytics?copilot=1` },
        { key: "viewOpportunities", href: `${base}/analytics?ws=growth` },
        { key: "trackedRecommendations", href: `${base}/agents/tracking` },
      ];
    case "sirocco":
      return [
        { key: "directCampaign", href: `${base}/campaigns` },
        { key: "multiNetworkSocial", href: `${base}/social` },
        { key: "imageStudio", href: `${base}/images/studio` },
      ];
    case "dune":
      return [
        { key: "writeArticle", href: `${base}/articles` },
        { key: "createSocialPosts", href: `${base}/social` },
      ];
    case "mirage":
      return [
        { key: "productShots", href: `${base}/images/studio?mode=create&intent=product` },
        { key: "editImage", href: `${base}/images/studio?mode=edit` },
        { key: "library", href: `${base}/images` },
      ];
    case "sable":
      return [{ key: "scanCompetitor", href: `${base}/analytics?ws=competitors` }];
    case "oasis":
      return [
        { key: "marketReport", href: `${base}/analytics?ws=market&oasis=1` },
        { key: "defineIdealClient", href: `${base}/agents/nomad` },
      ];
    case "nomad":
      return [
        { key: "planOutreach", href: `${base}/agents/nomad` },
        { key: "testimonialContent", href: `${base}/agents/nomad` },
      ];
    default:
      return [];
  }
}

function AgentCard({ agent, base, recommended }: { agent: FennexAgent; base: string; recommended: boolean }) {
  const { t } = useTranslation();
  const actions = agentActions(agent.id, base);
  const capabilities = t(`agentsRoster.${agent.id}.capabilities`, { returnObjects: true, defaultValue: agent.capabilities }) as string[];
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <agent.Icon className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-base font-bold text-foreground">{agent.name}</p>
            {recommended && (
              <span className="rounded-full bg-success/12 px-2 py-0.5 text-[10px] font-semibold text-success">
                {t("agentsPage.recommended")}
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-primary">{t(`agentsRoster.${agent.id}.role`, { defaultValue: agent.role })}</p>
          <p className="mt-0.5 text-xs italic text-muted-foreground">&ldquo;{t(`agentsRoster.${agent.id}.tagline`, { defaultValue: agent.tagline })}&rdquo;</p>
        </div>
      </div>

      <ul className="mt-4 flex flex-1 flex-col gap-1.5">
        {capabilities.map((c) => (
          <li key={c} className="flex items-start gap-2 text-xs text-muted-foreground">
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-success" strokeWidth={2.5} />
            {c}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        {actions.map((a, i) => (
          <Link
            key={a.href}
            href={a.href}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              i === 0
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-border text-foreground hover:bg-accent",
            )}
          >
            {t(`agentsPage.actions.${a.key}`)} <ArrowRight className="h-3 w-3" />
          </Link>
        ))}
      </div>
    </Card>
  );
}

export default function AgentsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const base = `/${projectId}`;

  const { data: projects = [] } = useQuery({ queryKey: ["projects"], queryFn: listProjects, staleTime: 60_000 });
  const persona = projects.find((p) => p.id === projectId)?.persona ?? null;

  const agents = Object.values(FENNEX_AGENTS);
  // Recommended agents first when a persona is set
  const sorted = persona
    ? [...agents].sort((a, b) => Number(b.personaFit.includes(persona)) - Number(a.personaFit.includes(persona)))
    : agents;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-primary text-white shadow-sm">
          <Sparkles className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">{t("agentsPage.title")}</h1>
          <p className="text-xs text-muted-foreground leading-tight">
            {t("agentsPage.subtitle")}
            {persona ? t("agentsPage.subtitleTuned") : ""}
          </p>
        </div>
      </div>

      {/* Assemble the squad — the Virtual Agency (campaign orchestration) */}
      <Link
        href={`${base}/campaigns`}
        className="group relative flex items-center gap-4 overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.09] via-primary/[0.03] to-transparent p-5 transition-colors hover:border-primary/40"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{ background: "radial-gradient(520px 160px at 8% -40%, hsl(var(--primary) / 0.16), transparent 60%)" }}
        />
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/70 text-white shadow-sm">
          <Megaphone className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="relative min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{t("agentsPage.squad.title")}</p>
          <p className="text-xs text-muted-foreground">{t("agentsPage.squad.desc")}</p>
        </div>
        <span className="relative flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-transform group-hover:translate-x-0.5">
          {t("agentsPage.squad.cta")} <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </Link>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sorted.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            base={base}
            recommended={!!persona && agent.personaFit.includes(persona)}
          />
        ))}

        {/* Coming soon */}
        {UPCOMING_AGENTS.map((a) => (
          <Card key={a.name} className="flex flex-col justify-between border-dashed p-5 opacity-75">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <a.Icon className="h-5 w-5" strokeWidth={1.8} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-base font-bold text-foreground">{a.name}</p>
                  <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    <Lock className="h-2.5 w-2.5" /> {t("agentsPage.comingSoon")}
                  </span>
                </div>
                <p className="text-xs font-medium text-muted-foreground">{a.role}</p>
                <p className="mt-0.5 text-xs italic text-muted-foreground">&ldquo;{a.tagline}&rdquo;</p>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
