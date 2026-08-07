"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import {
  ArrowLeft, BarChart3, Bot, CalendarClock, Layers, Loader2, MessageSquare,
  Pause, Play, RefreshCw, Rocket, Target,
} from "lucide-react";
import {
  cancelCampaign, getCampaign, regenerateStrategy, runCampaign, setCampaignStatus,
  type Campaign,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { statusBadgeClass } from "@/lib/campaignStatus";
import { Assumption, Section, money } from "@/components/campaigns/CampaignPrimitives";
import {
  ChannelsTab, CopilotTab, LaunchTab, PerformanceTab, TeamTab, TimelineTab,
} from "@/components/campaigns/CampaignTabs";
import { CampaignCanvas } from "@/components/campaigns/CampaignCanvas";
import { StepPanel } from "@/components/campaigns/StepPanel";
import { LiveFeed } from "@/components/campaigns/LiveFeed";
import { PackagePanel } from "@/components/campaigns/PackagePanel";

/**
 * One campaign, in the order a person works through it.
 *
 * Brief, then channels and content, then the timeline, then launch, then what it
 * earned. That sequence is the feature: the tabs are stages of the same job, not
 * a filing cabinet. The agent playbook keeps its own tab because campaigns
 * created by the autopilot and the delegate flow still arrive as agent steps and
 * would otherwise become unreachable.
 */

type Tab = "brief" | "team" | "channels" | "timeline" | "launch" | "performance" | "copilot";

export default function CampaignDetailPage({ params }: {
  params: { projectId: string; campaignId: string };
}) {
  const { projectId, campaignId } = params;
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("brief");
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const { data: campaign, isLoading } = useQuery({
    queryKey: ["campaign", campaignId],
    queryFn: () => getCampaign(campaignId),
    refetchInterval: (q) => (q.state.data?.steps.some((s) => s.status === "running") ? 2500 : false),
  });

  const setStatus = useMutation({
    mutationFn: (status: string) => setCampaignStatus(campaignId, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", campaignId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !campaign) {
    return <div className="m-6 h-64 animate-pulse rounded-xl border border-border bg-muted/30" />;
  }

  // The team is a permanent tab in second place, not one that appears only for
  // campaigns that happen to carry agent steps. A campaign IS work done by a
  // combination of agents; hiding who is doing it made that invisible on every
  // campaign the strategy engine created.
  const TABS: [Tab, typeof Target, string][] = [
    ["brief", Target, t("campaigns.tab.brief", { defaultValue: "Brief" })],
    ["team", Bot, t("campaigns.tab.team", { defaultValue: "Team" })],
    ["channels", Layers, t("campaigns.tab.channels", { defaultValue: "Channels & content" })],
    ["timeline", CalendarClock, t("campaigns.tab.timeline", { defaultValue: "Timeline" })],
    ["launch", Rocket, t("campaigns.tab.launch", { defaultValue: "Launch" })],
    ["performance", BarChart3, t("campaigns.tab.performance", { defaultValue: "Performance" })],
    ["copilot", MessageSquare, t("campaigns.tab.copilot", { defaultValue: "Ask" })],
  ];

  return (
    <div className="flex flex-col gap-5 p-6">
      <Link href={`/${projectId}/campaigns`}
            className="flex w-fit items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" />
        {t("campaigns.title", { defaultValue: "Campaigns" })}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">{campaign.name}</h1>
            <span className={statusBadgeClass(campaign.status)}>
              {t(`campaigns.status.${campaign.status}`, { defaultValue: campaign.status })}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {campaign.objective && t(`campaigns.objective.${campaign.objective}`, { defaultValue: campaign.objective })}
            {campaign.slug && <> · <span className="font-mono">{campaign.slug}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {campaign.status === "running" && (
            <button onClick={() => setStatus.mutate("paused")}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:border-foreground/20">
              <Pause className="h-3.5 w-3.5" />
              {t("campaigns.pause", { defaultValue: "Pause" })}
            </button>
          )}
          {campaign.status === "paused" && (
            <button onClick={() => setStatus.mutate("running")}
                    className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:border-foreground/20">
              <Play className="h-3.5 w-3.5" />
              {t("campaigns.resume", { defaultValue: "Resume" })}
            </button>
          )}
        </div>
      </header>

      <nav className="flex items-center gap-1 overflow-x-auto border-b border-border">
        {TABS.map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
              tab === key ? "border-primary text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {label}
          </button>
        ))}
      </nav>

      {tab === "brief" && <BriefTab campaign={campaign} projectId={projectId} />}
      {tab === "channels" && <ChannelsTab campaign={campaign} projectId={projectId} />}
      {tab === "timeline" && <TimelineTab campaign={campaign} projectId={projectId} />}
      {tab === "launch" && <LaunchTab campaign={campaign} projectId={projectId} />}
      {tab === "performance" && <PerformanceTab campaign={campaign} />}
      {tab === "copilot" && <CopilotTab campaign={campaign} />}
      {tab === "team" && (
        <TeamTab campaign={campaign}>
          {/* The playbook canvas belongs with the team that runs it, not in a
              tab of its own. Campaigns with no steps simply have no canvas. */}
          {campaign.steps.length > 0 && (
            <AgentsTab campaign={campaign} projectId={projectId}
                       selectedStepId={selectedStepId} onSelectStep={setSelectedStepId} />
          )}
        </TeamTab>
      )}
    </div>
  );
}

function BriefTab({ campaign, projectId }: { campaign: Campaign; projectId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const strategy = campaign.strategy;

  const replan = useMutation({
    mutationFn: () => regenerateStrategy(campaign.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", campaign.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const currency = campaign.budget.currency ?? "EUR";
  const audience = campaign.audience;

  return (
    <div className="flex flex-col gap-5">
      {campaign.brief_summary && (
        <Card className="p-5">
          <p className="text-sm leading-relaxed text-foreground">{campaign.brief_summary}</p>
          {strategy?.grounded === false && (
            <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-foreground">
              {t("campaigns.brief.ungrounded", {
                defaultValue: "No orders were synced when this was planned, so nothing grounded it in your store's own numbers.",
              })}
            </p>
          )}
        </Card>
      )}

      {(campaign.team ?? []).length > 0 && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("campaigns.brief.team", { defaultValue: "On this campaign" })}
          </span>
          {(campaign.team ?? []).map((m) => (
            <span key={m.id} title={m.role}
                  className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] text-foreground">
              {m.name}
              <span className="text-muted-foreground">
                {m.channels.length
                  ? m.channels.map((c) => t(`campaigns.channel.${c}`, { defaultValue: c })).join(", ")
                  : t("campaigns.brief.planning", { defaultValue: "planning" })}
              </span>
            </span>
          ))}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("campaigns.brief.audience", { defaultValue: "Audience" })}
          </h3>
          {audience?.label ? (
            <>
              <p className="text-sm font-medium text-foreground">{audience.label}</p>
              {audience.definition && (
                <p className="text-xs leading-relaxed text-muted-foreground">{audience.definition}</p>
              )}
              {/* The honest half. Fennex holds no customer records, so it says
                  who could build this list rather than showing a made-up size.
                  Composed here, not returned by the API, so it is in the
                  reader's language. */}
              <p className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                {audience.resolvable
                  ? t("campaigns.brief.audienceReady", {
                      defaultValue: "Ready to hand to {{app}}. Fennex does not hold the customer list itself.",
                      app: audience.resolver,
                    })
                  : t("campaigns.brief.audienceUnresolvable", {
                      defaultValue: "Fennex stores no customer records. Connect Klaviyo, Mailchimp, Shopify or Meta Ads to build this audience from real people.",
                    })}
              </p>
              {audience.unsupported?.length ? (
                <p className="text-[11px] leading-relaxed text-warning">
                  {t("campaigns.brief.unsupported", { defaultValue: "Not expressible as a filter:" })}{" "}
                  {audience.unsupported.join("; ")}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("campaigns.brief.noAudience", { defaultValue: "No audience defined." })}
            </p>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("campaigns.brief.offer", { defaultValue: "Offer" })}
          </h3>
          {campaign.offer?.type && campaign.offer.type !== "none" ? (
            <>
              <p className="text-sm font-medium text-foreground">
                {campaign.offer.value} · {t(`campaigns.offerType.${campaign.offer.type}`, { defaultValue: campaign.offer.type })}
              </p>
              {campaign.offer.description && (
                <p className="text-xs leading-relaxed text-muted-foreground">{campaign.offer.description}</p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("campaigns.brief.noOffer", { defaultValue: "No offer. Copy will not invent one." })}
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("campaigns.brief.budget", { defaultValue: "Budget" })}
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">
            {money(campaign.budget.amount, currency)}
          </p>
          {strategy?.budget?.basis && (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{strategy.budget.basis}</p>
          )}
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("campaigns.brief.dates", { defaultValue: "Dates" })}
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {campaign.starts_on ?? t("campaigns.brief.noStart", { defaultValue: "Not scheduled" })}
            {campaign.ends_on ? ` → ${campaign.ends_on}` : ""}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {t("campaigns.brief.kpi", { defaultValue: "Primary KPI" })}
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {campaign.primary_kpi
              ? t(`campaigns.kpi.${campaign.primary_kpi}`, { defaultValue: campaign.primary_kpi })
              : "—"}
          </p>
          {Object.keys(campaign.targets).length > 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {Object.entries(campaign.targets)
                .map(([k, v]) => `${t(`campaigns.kpi.${k}`, { defaultValue: k })} ${k === "revenue" ? money(v, currency) : v}`)
                .join(" · ")}
            </p>
          )}
        </Card>
      </div>

      {strategy?.assumptions?.length ? (
        <Section
          title={t("campaigns.brief.assumptions", { defaultValue: "What this plan assumes" })}
          description={t("campaigns.brief.assumptionsHint", {
            defaultValue: "Estimates, not measurements. Each one says what it rests on.",
          })}
        >
          <Card className="p-4">
            <ul className="flex flex-col gap-2">
              {strategy.assumptions.map((a, i) => (
                <Assumption key={i} claim={a.claim} restsOn={a.rests_on} />
              ))}
            </ul>
          </Card>
        </Section>
      ) : null}

      {strategy?.cannot_see?.length ? (
        <Section
          title={t("campaigns.brief.blind", { defaultValue: "What the plan could not see" })}
          description={t("campaigns.brief.blindHint", {
            defaultValue: "These were unavailable when the strategy was written, so nothing in it depends on them.",
          })}
        >
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {strategy.cannot_see.join(", ")}
            </p>
          </div>
        </Section>
      ) : null}

      <button onClick={() => replan.mutate()} disabled={replan.isPending}
              className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-foreground hover:border-foreground/20 disabled:opacity-50">
        {replan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {t("campaigns.brief.replan", { defaultValue: "Re-plan from current store data" })}
      </button>
    </div>
  );
}

function AgentsTab({ campaign, projectId, selectedStepId, onSelectStep }: {
  campaign: Campaign; projectId: string;
  selectedStepId: string | null; onSelectStep: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();

  const run = useMutation({
    mutationFn: () => runCampaign(campaign.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", campaign.id] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const stop = useMutation({
    mutationFn: () => cancelCampaign(campaign.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", campaign.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  // A playbook mid-run needs the live feed; a finished one needs its package,
  // which is where artifacts get shipped to the content calendar. Both were
  // orphaned when the old single-page campaigns screen was replaced.
  const playbookRunning = campaign.steps.some((s) => s.status === "running");
  const playbookDone = campaign.steps.length > 0
    && campaign.steps.every((s) => s.status !== "pending" && s.status !== "running");

  const activeStep = campaign.steps.find((s) => s.status === "running") ?? null;
  const selected = campaign.steps.find((s) => s.id === selectedStepId) ?? null;

  return (
    <Section
      title={t("campaigns.agents.title", { defaultValue: "Agent playbook" })}
      description={t("campaigns.agents.subtitle", {
        defaultValue: "The steps your agents run to produce this campaign's work.",
      })}
      action={
        ["ready", "planning", "draft"].includes(campaign.status) ? (
          <button onClick={() => run.mutate()} disabled={run.isPending}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {run.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {t("campaigns.agents.run", { defaultValue: "Run the playbook" })}
          </button>
        ) : undefined
      }
    >
      <CampaignCanvas campaign={campaign} activeStepId={activeStep?.id ?? null}
                      selectedStepId={selectedStepId} onSelectStep={onSelectStep} />
      {playbookRunning && (
        <LiveFeed campaign={campaign} onCancel={() => stop.mutate()} cancelling={stop.isPending} />
      )}
      {playbookDone && (
        <PackagePanel projectId={projectId} campaign={campaign} onRunAgain={() => run.mutate()} />
      )}
      {selected && (
        <StepPanel step={selected} campaign={campaign} projectId={projectId}
                   onClose={() => onSelectStep(null)} onRemove={() => onSelectStep(null)}
                   removing={false} />
      )}
    </Section>
  );
}
