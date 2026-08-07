"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import {
  ArrowLeft, BarChart3, Bot, CalendarClock, Layers, Loader2, MessageSquare,
  Pause, Play, RefreshCw, Rocket, Sparkles, Target,
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

/**
 * Four stages, not seven tabs.
 *
 * Brief, Team, Channels, Timeline, Launch, Performance and Ask were seven
 * places to look for one piece of work, and a person who just wants a campaign
 * out had to learn all of them first. They collapse to the four questions
 * actually being asked: what is the plan, what is being made, can it go, and
 * did it work. The NextStep bar above them answers the only question most
 * people have, which is "what do I do now".
 */
type Tab = "plan" | "work" | "launch" | "results";

export default function CampaignDetailPage({ params }: {
  params: { projectId: string; campaignId: string };
}) {
  const { projectId, campaignId } = params;
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("plan");
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
    ["plan", Target, t("campaigns.tab.plan", { defaultValue: "Plan" })],
    ["work", Layers, t("campaigns.tab.work", { defaultValue: "The work" })],
    ["launch", Rocket, t("campaigns.tab.launch", { defaultValue: "Launch" })],
    ["results", BarChart3, t("campaigns.tab.results", { defaultValue: "Results" })],
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

      <NextStep campaign={campaign} onGo={setTab} />

      {tab === "plan" && (
        <div className="flex flex-col gap-8">
          <BriefTab campaign={campaign} projectId={projectId} />
          <TeamTab campaign={campaign}>
            <AgentsTab campaign={campaign} projectId={projectId}
                       selectedStepId={selectedStepId} onSelectStep={setSelectedStepId} />
          </TeamTab>
        </div>
      )}
      {tab === "work" && (
        <div className="flex flex-col gap-8">
          <ChannelsTab campaign={campaign} projectId={projectId} />
          <TimelineTab campaign={campaign} projectId={projectId} />
        </div>
      )}
      {tab === "launch" && <LaunchTab campaign={campaign} projectId={projectId} />}
      {tab === "results" && (
        <div className="flex flex-col gap-8">
          <PerformanceTab campaign={campaign} />
          <CopilotTab campaign={campaign} />
        </div>
      )}
    </div>
  );
}

/**
 * The one thing to do next.
 *
 * Derived from the campaign's own state rather than from a stored step, so it
 * cannot go stale and there is no wizard to get stuck in. Everything stays
 * reachable through the tabs -- this only removes the need to work out which
 * tab, which is the part that made the tool feel like work.
 */
function NextStep({ campaign, onGo }: { campaign: Campaign; onGo: (tab: Tab) => void }) {
  const { t } = useTranslation();

  const channels = campaign.channels ?? [];
  const assets = campaign.assets ?? [];
  const pending = (campaign.approvals ?? []).filter((a) => a.state === "pending").length;

  let step: { text: string; cta: string; tab: Tab } | null = null;

  if (campaign.status === "completed" || campaign.status === "archived") {
    step = null;
  } else if (campaign.status === "running") {
    step = { tab: "results",
             text: t("campaigns.next.running", {
               defaultValue: "It is live. Watch what it earns and ask why when something moves." }),
             cta: t("campaigns.tab.results", { defaultValue: "Results" }) };
  } else if (!campaign.strategy) {
    step = { tab: "plan",
             text: t("campaigns.next.plan", {
               defaultValue: "No strategy yet. Let the team read your project and draft one." }),
             cta: t("campaigns.brief.replan", { defaultValue: "Build the plan" }) };
  } else if (!channels.length) {
    step = { tab: "work",
             text: t("campaigns.next.channels", {
               defaultValue: "Pick where this campaign runs. It needs at least one channel." }),
             cta: t("campaigns.channels.add", { defaultValue: "Add channel" }) };
  } else if (!assets.length) {
    step = { tab: "work",
             text: t("campaigns.next.content", {
               defaultValue: "Your team is ready to write. Nothing has been produced yet." }),
             cta: t("campaigns.content.write", { defaultValue: "Write content" }) };
  } else if (pending > 0) {
    step = { tab: "launch",
             text: t("campaigns.next.approvals", {
               defaultValue: "{{n}} action(s) need your approval before anything can go out.",
               n: pending }),
             cta: t("campaigns.approvals.approve", { defaultValue: "Review them" }) };
  } else {
    step = { tab: "launch",
             text: t("campaigns.next.launch", {
               defaultValue: "The work is made. Check what is left and put it live." }),
             cta: t("campaigns.launch.cta", { defaultValue: "Launch campaign" }) };
  }

  if (!step) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3.5">
      <Sparkles className="h-4 w-4 shrink-0 text-primary" strokeWidth={2} />
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-foreground">{step.text}</p>
      <button
        onClick={() => onGo(step.tab)}
        className="shrink-0 cursor-pointer rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
      >
        {step.cta}
      </button>
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
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="flex min-w-0 flex-col gap-5">
        {campaign.brief_summary && (
          <div>
            <p className="text-[15px] leading-relaxed text-foreground">{campaign.brief_summary}</p>
            {strategy?.grounded === false && (
              <p className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-foreground">
                {t("campaigns.brief.ungrounded", {
                  defaultValue: "No orders were synced when this was planned, so nothing grounded it in your store's own numbers.",
                })}
              </p>
            )}
          </div>
        )}

        {(campaign.team ?? []).length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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
          </div>
        )}

        {strategy?.assumptions?.length ? (
          <Section
            title={t("campaigns.brief.assumptions", { defaultValue: "What this plan assumes" })}
            description={t("campaigns.brief.assumptionsHint", {
              defaultValue: "Estimates, not measurements. Each one says what it rests on.",
            })}
          >
            <ul className="flex flex-col gap-2 border-l-2 border-border pl-4">
              {strategy.assumptions.map((a, i) => (
                <Assumption key={i} claim={a.claim} restsOn={a.rests_on} />
              ))}
            </ul>
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

      {/* The facts rail. A definition list, not cards: these are checked, not
          read, and eight bordered boxes made scanning them slower than a table
          would have. */}
      <aside className="flex flex-col divide-y divide-border rounded-xl border border-border">
        <Fact label={t("campaigns.brief.audience", { defaultValue: "Audience" })}>
          {audience?.label ? (
            <>
              <p className="text-xs font-medium text-foreground">{audience.label}</p>
              {audience.definition && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{audience.definition}</p>
              )}
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
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
                <p className="mt-1 text-[11px] leading-relaxed text-warning">
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
        </Fact>

        <Fact label={t("campaigns.brief.offer", { defaultValue: "Offer" })}>
          {campaign.offer?.type && campaign.offer.type !== "none" ? (
            <>
              <p className="text-xs font-medium text-foreground">
                {campaign.offer.value} · {t(`campaigns.offerType.${campaign.offer.type}`, { defaultValue: campaign.offer.type })}
              </p>
              {campaign.offer.description && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{campaign.offer.description}</p>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t("campaigns.brief.noOffer", { defaultValue: "No offer. Copy will not invent one." })}
            </p>
          )}
        </Fact>

        <Fact label={t("campaigns.brief.budget", { defaultValue: "Budget" })}>
          <p className="text-sm font-semibold tabular-nums text-foreground">
            {money(campaign.budget.amount, currency)}
          </p>
          {strategy?.budget?.basis && (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{strategy.budget.basis}</p>
          )}
        </Fact>

        <Fact label={t("campaigns.brief.dates", { defaultValue: "Dates" })}>
          <p className="text-xs font-medium tabular-nums text-foreground">
            {campaign.starts_on ?? t("campaigns.brief.noStart", { defaultValue: "Not scheduled" })}
            {campaign.ends_on ? ` → ${campaign.ends_on}` : ""}
          </p>
        </Fact>

        <Fact label={t("campaigns.brief.kpi", { defaultValue: "Primary KPI" })}>
          <p className="text-xs font-medium text-foreground">
            {campaign.primary_kpi
              ? t(`campaigns.kpi.${campaign.primary_kpi}`, { defaultValue: campaign.primary_kpi })
              : "—"}
          </p>
          {Object.keys(campaign.targets).length > 0 && (
            <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
              {Object.entries(campaign.targets)
                .map(([k, v]) => `${t(`campaigns.kpi.${k}`, { defaultValue: k })} ${k === "revenue" ? money(v, currency) : v}`)
                .join(" · ")}
            </p>
          )}
        </Fact>
      </aside>
    </div>
  );
}

/** One row of the facts rail. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-3.5">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {children}
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
