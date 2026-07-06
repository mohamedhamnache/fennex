"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Sparkles, Lock } from "lucide-react";
import { listProjects } from "@/lib/api";
import { FENNEX_AGENTS, UPCOMING_AGENTS, type FennexAgent } from "@/lib/agents";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

interface AgentAction {
  label: string;
  href: string;
}

function agentActions(agentId: string, base: string): AgentAction[] {
  switch (agentId) {
    case "zerda":
      return [
        { label: "Ask Zerda", href: `${base}/analytics?copilot=1` },
        { label: "View opportunities", href: `${base}/analytics?ws=growth` },
        { label: "Tracked recommendations", href: `${base}/agents/tracking` },
      ];
    case "sirocco":
      return [
        { label: "Plan a campaign", href: `${base}/images/studio?mode=ai` },
        { label: "Open image studio", href: `${base}/images/studio` },
      ];
    case "dune":
      return [
        { label: "Write an article", href: `${base}/articles` },
        { label: "Create social posts", href: `${base}/social` },
      ];
    case "mirage":
      return [
        { label: "Edit an image", href: `${base}/images/studio?mode=edit` },
        { label: "Open the library", href: `${base}/images` },
      ];
    case "sable":
      return [{ label: "Scan a competitor", href: `${base}/analytics?ws=competitors` }];
    case "oasis":
      return [{ label: "Generate a market report", href: `${base}/analytics?ws=market&oasis=1` }];
    case "nomad":
      return [
        { label: "Plan my outreach week", href: `${base}/agents/nomad` },
        { label: "View LinkedIn drafts", href: `${base}/social` },
      ];
    default:
      return [];
  }
}

function AgentCard({ agent, base, recommended }: { agent: FennexAgent; base: string; recommended: boolean }) {
  const actions = agentActions(agent.id, base);
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
                Recommended for you
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-primary">{agent.role}</p>
          <p className="mt-0.5 text-xs italic text-muted-foreground">&ldquo;{agent.tagline}&rdquo;</p>
        </div>
      </div>

      <ul className="mt-4 flex flex-1 flex-col gap-1.5">
        {agent.capabilities.map((c) => (
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
            {a.label} <ArrowRight className="h-3 w-3" />
          </Link>
        ))}
      </div>
    </Card>
  );
}

export default function AgentsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
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
          <h1 className="text-lg font-bold text-foreground leading-tight">The Fennex Pack</h1>
          <p className="text-xs text-muted-foreground leading-tight">
            Your AI team — seven specialists, each grounded in your real data
            {persona ? " · recommendations tuned to your profile" : ""}
          </p>
        </div>
      </div>

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
                    <Lock className="h-2.5 w-2.5" /> Coming soon
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
