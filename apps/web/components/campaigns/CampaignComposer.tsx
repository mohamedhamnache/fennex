"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";
import { listProjects, type Campaign } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { AGENT_VISUALS, CAMPAIGN_TEMPLATES, agentVisual } from "@/lib/campaignMeta";

interface CampaignComposerProps {
  projectId: string;
  campaigns: Campaign[];
  goal: string;
  setGoal: (g: string) => void;
  onDraft: () => void;
  drafting: boolean;
  onOpenCampaign: (id: string) => void;
}

// Same tone mapping as the campaigns page's statusBadgeClass — duplicated here
// (rather than threaded through as a prop) since it's a small, static lookup.
const CAMPAIGN_STATUS_BADGE: Record<Campaign["status"], string> = {
  planned: "bg-muted text-muted-foreground",
  running: "bg-primary/12 text-primary",
  completed: "bg-success/12 text-success",
  failed: "bg-destructive/12 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function statusBadgeClass(status: Campaign["status"]): string {
  return cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", CAMPAIGN_STATUS_BADGE[status]);
}

export function CampaignComposer({
  projectId,
  campaigns,
  goal,
  setGoal,
  onDraft,
  drafting,
  onOpenCampaign,
}: CampaignComposerProps) {
  const { t, i18n } = useTranslation();

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
  });
  const persona = projects.find((p) => p.id === projectId)?.persona ?? "creator";

  const templates = CAMPAIGN_TEMPLATES.filter((tp) => tp.personas.includes(persona));

  return (
    <div className="flex flex-col gap-8">
      <div className="mx-auto flex max-w-xl flex-col items-center gap-3 text-center">
        <div className="flex">
          {Object.values(AGENT_VISUALS).map((visual, i) => {
            const Icon = visual.Icon;
            return (
              <div
                key={visual.name}
                className={cn(
                  "-ml-2 flex h-9 w-9 items-center justify-center rounded-full border-2 border-background bg-gradient-to-br text-white shadow-sm first:ml-0",
                  visual.gradient,
                  drafting && "animate-pulse-dot",
                )}
                style={drafting ? { animationDelay: `${i * 120}ms` } : undefined}
              >
                <Icon className="h-4 w-4" strokeWidth={1.8} />
              </div>
            );
          })}
        </div>
        <h1 className="text-xl font-bold text-foreground">{t("campaigns.composer.headline")}</h1>
        <p className="text-xs text-muted-foreground">{t("campaigns.composer.subline")}</p>
      </div>

      <div className="mx-auto w-full max-w-xl">
        <Card className="p-5">
          <textarea
            id="campaign-goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t("campaigns.goalPlaceholder")}
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          />
          <div className="mt-3 flex justify-end">
            <button
              onClick={onDraft}
              disabled={drafting || !goal.trim()}
              className="btn-primary flex items-center gap-2 px-5 py-2 text-sm"
            >
              {drafting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("campaigns.drafting")}
                </>
              ) : (
                t("campaigns.composer.cta")
              )}
            </button>
          </div>
        </Card>

        {templates.length > 0 && (
          <div className="mt-3">
            <div className="flex flex-wrap gap-2">
              {templates.map((tp) => (
                <button
                  key={tp.key}
                  onClick={() => setGoal(t(`campaigns.templates.${tp.key}.goal`))}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  {t(`campaigns.templates.${tp.key}.label`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("campaigns.composer.templatesHint")}</p>
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t("campaigns.composer.past")}
        </p>
        {campaigns.length === 0 ? (
          <Card className="p-6 text-center text-sm text-muted-foreground">{t("campaigns.empty")}</Card>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campaigns.map((c) => {
              const seen = new Set<string>();
              const avatars = c.steps
                .map((s) => s.agent)
                .filter((agent) => {
                  if (seen.has(agent)) return false;
                  seen.add(agent);
                  return true;
                })
                .slice(0, 5)
                .map((agent) => agentVisual(agent));

              return (
                <Card
                  key={c.id}
                  interactive
                  onClick={() => onOpenCampaign(c.id)}
                  className="flex flex-col gap-3 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{c.goal}</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {c.source === "autopilot" && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          {t("autopilot.badge")}
                          {c.week_of && (
                            <>
                              {" · "}
                              {t("autopilot.weekOf", {
                                date: new Date(`${c.week_of}T00:00:00`).toLocaleDateString(i18n.language, {
                                  month: "short", day: "numeric",
                                }),
                              })}
                            </>
                          )}
                        </span>
                      )}
                      <span className={statusBadgeClass(c.status)}>{t(`campaigns.status.${c.status}`)}</span>
                    </div>
                  </div>
                  <div className="flex">
                    {avatars.map((visual, i) => {
                      const Icon = visual.Icon;
                      return (
                        <div
                          key={`${c.id}-${visual.name}-${i}`}
                          className={cn(
                            "-ml-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-background bg-gradient-to-br text-white first:ml-0",
                            visual.gradient,
                          )}
                        >
                          <Icon className="h-3 w-3" strokeWidth={1.8} />
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
