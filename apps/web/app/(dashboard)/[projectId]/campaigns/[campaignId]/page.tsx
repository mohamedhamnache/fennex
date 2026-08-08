"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import {
  ArrowLeft, BarChart3, Bot, CalendarClock, Layers, Loader2, MessageSquare,
  LayoutDashboard, Pause, Play, RefreshCw, Rocket, Sparkles, Target,
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
import { CampaignPlan } from "@/components/campaigns/CampaignPlan";
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
type Tab = "overview" | "plan" | "work" | "launch" | "results";

export default function CampaignDetailPage({ params }: {
  params: { projectId: string; campaignId: string };
}) {
  const { projectId, campaignId } = params;
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
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
    // Overview answers "where is this and does it need me"; Plan answers "what
    // exactly is going to happen". They were one tab, which meant landing on a
    // page that opened with strategy prose when the question was usually
    // whether anything was waiting.
    ["overview", LayoutDashboard, t("campaigns.tab.overview", { defaultValue: "Overview" })],
    ["plan", Target, t("campaigns.tab.plan", { defaultValue: "Plan" })],
    ["work", Layers, t("campaigns.tab.work", { defaultValue: "Work" })],
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

      {tab === "overview" && (
        <CampaignPlan campaign={campaign} projectId={projectId}
                      onGoToTab={setTab} view="overview" />
      )}
      {tab === "plan" && (
        <CampaignPlan campaign={campaign} projectId={projectId} onGoToTab={setTab} view="plan">
          {campaign.steps.length > 0 && (
            <AgentsTab campaign={campaign} projectId={projectId}
                       selectedStepId={selectedStepId} onSelectStep={setSelectedStepId} />
          )}
        </CampaignPlan>
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
          <Stage n={3} title={t("campaigns.plan.why", { defaultValue: "Ask why" })}>
            <CopilotTab campaign={campaign} />
          </Stage>
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
/**
 * A numbered stage heading.
 *
 * The plan was three sections of identical weight with nothing saying how they
 * related, so it read as a pile rather than a sequence. Numbering is used here
 * because the content genuinely is ordered -- you cannot assign the work before
 * you know what the work is -- which is the only case where numbering carries
 * information rather than decorating.
 */
function Stage({ n, title, children }: {
  n: number; title: string; children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {n}
        </span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span aria-hidden className="h-px min-w-0 flex-1 bg-border" />
      </div>
      {children}
    </section>
  );
}

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
    /* One column, read top to bottom. The two-column version put a tall narrow
       rail beside a short narrative, which left four hundred pixels of dead
       space under the text and squeezed the audience definition into a column
       too narrow to read it in. A brief is a document, not a dashboard. */
    <div className="flex max-w-3xl flex-col gap-6">
      {campaign.brief_summary && (
        <p className="text-[15px] leading-relaxed text-foreground">{campaign.brief_summary}</p>
      )}
      {strategy?.grounded === false && (
        <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-foreground">
          {t("campaigns.brief.ungrounded", {
            defaultValue: "No orders were synced when this was planned, so nothing grounded it in your store's own numbers.",
          })}
        </p>
      )}

      {/* The facts, across rather than down. Five short values in a row are
          read at a glance; the same five stacked in a 300px column are a
          scroll. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border py-4 sm:grid-cols-4">
        <Fact label={t("campaigns.brief.offer", { defaultValue: "Offer" })}>
          {campaign.offer?.type && campaign.offer.type !== "none"
            ? `${campaign.offer.value ?? ""} · ${t(`campaigns.offerType.${campaign.offer.type}`, { defaultValue: campaign.offer.type })}`
            : t("campaigns.brief.noOfferShort", { defaultValue: "None" })}
        </Fact>
        <Fact label={t("campaigns.brief.budget", { defaultValue: "Budget" })}>
          {money(campaign.budget.amount, currency)}
        </Fact>
        <Fact label={t("campaigns.brief.dates", { defaultValue: "Dates" })}>
          {campaign.starts_on
            ? `${campaign.starts_on}${campaign.ends_on ? ` → ${campaign.ends_on}` : ""}`
            : t("campaigns.brief.noStart", { defaultValue: "Not scheduled" })}
        </Fact>
        <Fact label={t("campaigns.brief.kpi", { defaultValue: "Primary KPI" })}>
          {/* The target, not the KPI's own name again -- the label above already
              says which KPI this is. */}
          {campaign.primary_kpi
            ? (campaign.targets?.[campaign.primary_kpi] !== undefined
                ? (campaign.primary_kpi === "revenue"
                    ? money(campaign.targets[campaign.primary_kpi], currency)
                    : String(campaign.targets[campaign.primary_kpi]))
                : t(`campaigns.kpi.${campaign.primary_kpi}`, { defaultValue: campaign.primary_kpi }))
            : "—"}
        </Fact>
      </dl>

      {/* Audience is a paragraph, not a field, so it gets the width to be one. */}
      <div>
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("campaigns.brief.audience", { defaultValue: "Audience" })}
        </p>
        {audience?.label ? (
          <>
            <p className="text-sm font-medium text-foreground">{audience.label}</p>
            {audience.definition && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{audience.definition}</p>
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
      </div>

      {(strategy?.assumptions?.length || strategy?.cannot_see?.length) ? (
        <details className="group rounded-xl border border-border">
          <summary className="flex cursor-pointer items-center justify-between gap-2 p-3 text-xs font-medium text-foreground">
            {t("campaigns.brief.restsOn", { defaultValue: "What this plan rests on" })}
            <span className="text-[11px] text-muted-foreground transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="flex flex-col gap-4 border-t border-border p-3.5">
            {strategy?.assumptions?.length ? (
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("campaigns.brief.assumptions", { defaultValue: "What this plan assumes" })}
                </p>
                <ul className="flex flex-col gap-2 border-l-2 border-border pl-4">
                  {strategy.assumptions.map((a, i) => (
                    <Assumption key={i} claim={a.claim} restsOn={a.rests_on} />
                  ))}
                </ul>
              </div>
            ) : null}
            {strategy?.cannot_see?.length ? (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("campaigns.brief.blind", { defaultValue: "What the plan could not see" })}
                </p>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {strategy.cannot_see.join(", ")}
                </p>
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      <button onClick={() => replan.mutate()} disabled={replan.isPending}
              className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-foreground hover:border-foreground/20 disabled:opacity-50">
        {replan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        {t("campaigns.brief.replan", { defaultValue: "Re-plan from current store data" })}
      </button>
    </div>
  );
}

/** One short fact in the strip. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate text-sm font-medium tabular-nums text-foreground">{children}</dd>
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
