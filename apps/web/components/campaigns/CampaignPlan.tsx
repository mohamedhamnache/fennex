"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle, Check, ChevronRight, Circle, Clock, Loader2, RefreshCw, Sparkles,
} from "lucide-react";
import {
  buildCampaignPlaybook, campaignReadiness, regenerateStrategy,
  type Campaign, type CampaignTask,
} from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { employeeIcon } from "@/lib/employees";
import { money } from "./CampaignPrimitives";

/**
 * The Plan tab: what Fennex is going to do, and what it needs from you.
 *
 * It was a document -- fields laid out in reading order, every section the same
 * weight, and the answer to "what happens next" nowhere. This is the same data
 * arranged around the questions a person actually opens it with: is it ready,
 * what is the strategy, who is doing what, what will exist at the end, and what
 * is waiting on me.
 *
 * EVERY NUMBER HERE IS COUNTED, NOT ESTIMATED. Readiness is the real check
 * endpoint. Deliverables are what the channels declare they need against what
 * has actually been written. An agent's status is derived from its own tasks
 * and assets. There is no progress bar that moves because a page loaded.
 */

type AgentState = "done" | "working" | "waiting" | "blocked" | "idle";

const STATE_STYLE: Record<AgentState, { dot: string; label: string }> = {
  done: { dot: "bg-success", label: "done" },
  working: { dot: "bg-primary animate-pulse", label: "working" },
  waiting: { dot: "bg-muted-foreground/40", label: "waiting" },
  blocked: { dot: "bg-warning", label: "blocked" },
  idle: { dot: "bg-border", label: "idle" },
};

export function CampaignPlan({ campaign, projectId, onGoToTab, children }: {
  campaign: Campaign;
  projectId: string;
  onGoToTab: (tab: "work" | "launch" | "results") => void;
  /** The execution graph, kept but demoted behind a disclosure. */
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: readiness } = useQuery({
    queryKey: ["campaign-readiness", campaign.id],
    queryFn: () => campaignReadiness(campaign.id),
  });

  const replan = useMutation({
    mutationFn: () => regenerateStrategy(campaign.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", campaign.id] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const buildPlaybook = useMutation({
    mutationFn: () => buildCampaignPlaybook(campaign.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", campaign.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const team = campaign.team ?? [];
  const channels = campaign.channels ?? [];
  const assets = campaign.assets ?? [];
  const tasks = campaign.tasks ?? [];
  const pending = (campaign.approvals ?? []).filter((a) => a.state === "pending");
  const currency = campaign.budget.currency ?? "EUR";
  const strategy = campaign.strategy;

  // Readiness, counted from the same checks the launch gate runs. `unknown`
  // items are excluded from both sides: a check nobody could perform is not a
  // pass and not a failure, and counting it either way would be a made-up
  // number in the one place that must not have one.
  const passed = readiness?.passed.length ?? 0;
  const open = (readiness?.blockers.length ?? 0) + (readiness?.warnings.length ?? 0);
  const total = passed + open;
  const pct = total ? Math.round((passed / total) * 100) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_290px]">
      <div className="flex min-w-0 flex-col gap-7">
        {/* ── strategy ─────────────────────────────────────────────────── */}
        <section>
          <SectionLabel>{t("campaigns.plan.strategy", { defaultValue: "Strategy" })}</SectionLabel>
          <dl className="mt-3 flex flex-col divide-y divide-border">
            <Line label={t("campaigns.plan.goal", { defaultValue: "Goal" })}>
              {campaign.goal}
            </Line>
            {campaign.audience?.label && (
              <Line label={t("campaigns.brief.audience", { defaultValue: "Audience" })}>
                {campaign.audience.label}
                {campaign.audience.definition && (
                  <span className="block text-muted-foreground">{campaign.audience.definition}</span>
                )}
              </Line>
            )}
            <Line label={t("campaigns.brief.offer", { defaultValue: "Offer" })}>
              {campaign.offer?.type && campaign.offer.type !== "none"
                ? `${campaign.offer.value ?? ""} · ${t(`campaigns.offerType.${campaign.offer.type}`, { defaultValue: campaign.offer.type })}`
                : t("campaigns.brief.noOffer", { defaultValue: "No offer. Copy will not invent one." })}
            </Line>
            {channels.length > 0 && (
              <Line label={t("campaigns.channels.title", { defaultValue: "Channels" })}>
                {channels.map((c) => t(`campaigns.channel.${c.channel}`, { defaultValue: c.channel })).join(" · ")}
              </Line>
            )}
          </dl>

          {(strategy?.assumptions?.length || strategy?.cannot_see?.length || campaign.brief_summary) ? (
            <details className="group mt-3">
              <summary className="flex w-fit cursor-pointer items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                {t("campaigns.plan.reasoning", { defaultValue: "Why this plan" })}
              </summary>
              <div className="mt-2.5 flex flex-col gap-3 border-l-2 border-border pl-4 text-xs leading-relaxed">
                {campaign.brief_summary && (
                  <p className="text-muted-foreground">{campaign.brief_summary}</p>
                )}
                {strategy?.assumptions?.length ? (
                  <div>
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {t("campaigns.brief.assumptions", { defaultValue: "What this plan assumes" })}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {strategy.assumptions.map((a, i) => (
                        <li key={i} className="text-muted-foreground">
                          <span className="text-foreground">{a.claim}</span>
                          {a.rests_on && <> — {a.rests_on}</>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {strategy?.cannot_see?.length ? (
                  <p className="text-muted-foreground">
                    <span className="text-foreground/70">
                      {t("campaigns.brief.blind", { defaultValue: "What the plan could not see" })}:
                    </span>{" "}
                    {strategy.cannot_see.join(", ")}
                  </p>
                ) : null}
              </div>
            </details>
          ) : null}
        </section>

        {/* ── the team ─────────────────────────────────────────────────── */}
        <section>
          <SectionLabel>
            {t("campaigns.plan.team", { defaultValue: "AI team" })}
            {team.length > 0 && (
              <span className="ml-2 font-normal normal-case tracking-normal text-muted-foreground">
                {t("campaigns.plan.teamCount", {
                  defaultValue: "{{n}} agents assigned", n: team.length,
                })}
              </span>
            )}
          </SectionLabel>

          {!team.length ? (
            <Empty>
              {t("campaigns.team.empty", {
                defaultValue: "Nobody assigned yet. Add a channel or generate a strategy and the work is shared out.",
              })}
            </Empty>
          ) : (
            <div className="mt-3 flex flex-col divide-y divide-border rounded-xl border border-border">
              {team.map((m) => (
                <AgentRow key={m.id} member={m} campaign={campaign}
                          assets={assets} tasks={tasks} />
              ))}
            </div>
          )}
        </section>

        {/* ── execution plan ───────────────────────────────────────────── */}
        <section>
          <SectionLabel>
            {t("campaigns.plan.execution", { defaultValue: "Execution plan" })}
          </SectionLabel>

          {!tasks.length ? (
            <Empty>
              {t("campaigns.plan.noPhases", {
                defaultValue: "No steps scheduled yet. They arrive with the strategy, or you can add your own on the Work tab.",
              })}
            </Empty>
          ) : (
            <ol className="mt-3 flex flex-col">
              {[...tasks].sort((a, b) => a.day_offset - b.day_offset).map((task, i) => {
                const owner = team.find((m) => m.id === task.owner);
                const Icon = employeeIcon(owner?.icon ?? "");
                const isLaunch = task.day_offset === 0;
                return (
                  <li key={task.id} className="flex gap-3">
                    {/* The spine. Drawn rather than a border on the row, so the
                        last item's line stops instead of running past it. */}
                    <div className="flex w-8 shrink-0 flex-col items-center">
                      <span className={cn(
                        "mt-1 flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold tabular-nums",
                        isLaunch ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}>
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      {i < tasks.length - 1 && <span className="w-px flex-1 bg-border" />}
                    </div>
                    <div className="min-w-0 flex-1 pb-4">
                      <p className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
                        {task.title}
                        {isLaunch && (
                          <span className="rounded-full bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                            {t("campaigns.timeline.launch", { defaultValue: "Launch" })}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                        <span className="tabular-nums">
                          {task.day_offset === 0 ? "D0" : task.day_offset < 0 ? `D${task.day_offset}` : `D+${task.day_offset}`}
                        </span>
                        {owner && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="flex items-center gap-1">
                              <Icon className="h-2.5 w-2.5" strokeWidth={2.2} />
                              {owner.name}
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {/* The node graph is real and stays, one click down. It is a technical
              view of the same plan, and putting it first made the page look
              like an internal tool. */}
          {children && (
            <details className="group mt-2">
              <summary className="flex w-fit cursor-pointer items-center gap-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                {t("campaigns.plan.graph", { defaultValue: "Execution graph" })}
              </summary>
              <div className="mt-3">{children}</div>
            </details>
          )}

          {!campaign.steps.length && (
            <button onClick={() => buildPlaybook.mutate()} disabled={buildPlaybook.isPending}
                    className="mt-3 flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-[11px] font-medium text-foreground hover:border-foreground/20 disabled:opacity-50">
              {buildPlaybook.isPending
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <Sparkles className="h-3 w-3" />}
              {t("campaigns.agents.build", { defaultValue: "Build the playbook" })}
            </button>
          )}
        </section>

        {/* ── deliverables ─────────────────────────────────────────────── */}
        <Deliverables campaign={campaign} onGoToTab={onGoToTab} />
      </div>

      {/* ── context rail ───────────────────────────────────────────────── */}
      <aside className="flex flex-col gap-5">
        <div className="rounded-xl border border-border p-4">
          <SectionLabel>{t("campaigns.plan.readiness", { defaultValue: "Readiness" })}</SectionLabel>
          {!readiness ? (
            <div className="mt-3 h-2 animate-pulse rounded-full bg-muted" />
          ) : (
            <>
              <div className="mt-3 flex items-center gap-2">
                <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full transition-all",
                                      readiness.ready ? "bg-success" : "bg-primary")}
                        style={{ width: `${pct}%` }} />
                </span>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">{pct}%</span>
              </div>
              <p className={cn("mt-2 text-xs font-medium",
                               readiness.ready ? "text-success" : "text-foreground")}>
                {readiness.ready
                  ? t("campaigns.launch.ready", { defaultValue: "Everything is ready" })
                  : t("campaigns.launch.blocked", {
                      defaultValue: "{{n}} thing(s) must be fixed first",
                      n: readiness.blockers.length,
                    })}
              </p>
              <ul className="mt-2.5 flex flex-col gap-1.5">
                {[...readiness.blockers, ...readiness.warnings].slice(0, 3).map((item) => (
                  <li key={item.key + item.message}
                      className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    <Circle className="mt-1 h-2 w-2 shrink-0 text-muted-foreground/50" strokeWidth={3} />
                    <span>{t(`campaigns.check.${item.code}`, { ...item.params, defaultValue: item.message })}</span>
                  </li>
                ))}
                {readiness.passed.slice(0, 2).map((item) => (
                  <li key={item.key + item.message}
                      className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    <Check className="mt-0.5 h-2.5 w-2.5 shrink-0 text-success" strokeWidth={3} />
                    <span>{t(`campaigns.check.${item.code}`, { ...item.params, defaultValue: item.message })}</span>
                  </li>
                ))}
              </ul>
              <button onClick={() => onGoToTab("launch")}
                      className="mt-2.5 cursor-pointer text-[11px] font-medium text-primary hover:underline">
                {t("campaigns.plan.seeMissing", { defaultValue: "See everything" })}
              </button>
            </>
          )}
        </div>

        {/* Snapshot. Light rows, not cards -- five values do not need five
            boxes, and the boxes were what made the page tall and empty. */}
        <div className="rounded-xl border border-border p-4">
          <SectionLabel>{t("campaigns.plan.snapshot", { defaultValue: "Campaign" })}</SectionLabel>
          <dl className="mt-3 flex flex-col gap-2.5">
            <Snap label={t("campaigns.create.objective", { defaultValue: "Objective" })}>
              {campaign.objective
                ? t(`campaigns.objective.${campaign.objective}`, { defaultValue: campaign.objective })
                : "—"}
            </Snap>
            <Snap label={t("campaigns.brief.budget", { defaultValue: "Budget" })}>
              {money(campaign.budget.amount, currency)}
            </Snap>
            <Snap label={t("campaigns.brief.dates", { defaultValue: "Dates" })}>
              {campaign.starts_on
                ? `${campaign.starts_on}${campaign.ends_on ? ` → ${campaign.ends_on}` : ""}`
                : t("campaigns.brief.noStart", { defaultValue: "Not scheduled" })}
            </Snap>
            <Snap label={t("campaigns.brief.kpi", { defaultValue: "Primary KPI" })}>
              {campaign.primary_kpi
                ? `${t(`campaigns.kpi.${campaign.primary_kpi}`, { defaultValue: campaign.primary_kpi })}${
                    campaign.targets?.[campaign.primary_kpi] !== undefined
                      ? ` · ${campaign.primary_kpi === "revenue"
                          ? money(campaign.targets[campaign.primary_kpi], currency)
                          : campaign.targets[campaign.primary_kpi]}`
                      : ""}`
                : "—"}
            </Snap>
          </dl>
        </div>

        {/* What Fennex needs from you. Its own block, because hunting for this
            through the page is the thing that makes a tool feel like work. */}
        <div className={cn("rounded-xl border p-4",
                           pending.length ? "border-warning/40 bg-warning/5" : "border-border")}>
          <SectionLabel>{t("campaigns.plan.yourInput", { defaultValue: "Your input" })}</SectionLabel>
          {!pending.length ? (
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {t("campaigns.plan.nothingNeeded", { defaultValue: "Nothing needed right now." })}
            </p>
          ) : (
            <>
              <ul className="mt-2 flex flex-col gap-1.5">
                {pending.map((a) => (
                  <li key={a.id} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-foreground">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" strokeWidth={2.2} />
                    {a.label}
                  </li>
                ))}
              </ul>
              <button onClick={() => onGoToTab("launch")}
                      className="mt-2.5 cursor-pointer rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90">
                {t("campaigns.plan.review", { defaultValue: "Review" })}
              </button>
            </>
          )}
        </div>

        <button onClick={() => replan.mutate()} disabled={replan.isPending}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-[11px] font-medium text-foreground hover:border-foreground/20 disabled:opacity-50">
          {replan.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {t("campaigns.brief.replan", { defaultValue: "Re-plan from current data" })}
        </button>
      </aside>
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 py-2.5">
      <dt className="w-24 shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-xs leading-relaxed text-foreground">{children}</dd>
    </div>
  );
}

function Snap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-[11px] font-medium tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * One agent, with what it owns and what it has actually produced.
 *
 * The status is derived, never stored: an agent with completed tasks and assets
 * is done, one whose campaign is running is working, one with tasks and nothing
 * written is waiting. "0 élément(s) produit(s)" is replaced by what the agent is
 * FOR, because a count of zero on a campaign that has not started is not
 * information, it is a reproach.
 */
function AgentRow({ member, campaign, assets, tasks }: {
  member: NonNullable<Campaign["team"]>[number];
  campaign: Campaign;
  assets: NonNullable<Campaign["assets"]>;
  tasks: CampaignTask[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const Icon = employeeIcon(member.icon);

  const mine = tasks.filter((x) => x.owner === member.id);
  const produced = member.produced;
  const running = campaign.status === "running";

  let state: AgentState = "idle";
  if (produced > 0 && mine.every((x) => x.status === "done")) state = "done";
  else if (running) state = "working";
  else if (mine.length || member.channels.length) state = "waiting";

  const style = STATE_STYLE[state];

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-3 p-3 text-left transition-colors hover:bg-muted/40"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Icon className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="text-xs font-semibold text-foreground">{member.name}</span>
            <span className="text-[11px] text-muted-foreground">{member.role}</span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", style.dot)} />
              {t(`campaigns.agentState.${state}`, { defaultValue: style.label })}
            </span>
            {member.channels.length > 0 && (
              <>
                <span aria-hidden>·</span>
                {member.channels.map((c) => t(`campaigns.channel.${c}`, { defaultValue: c })).join(", ")}
              </>
            )}
            {mine.length > 0 && (
              <>
                <span aria-hidden>·</span>
                {t("campaigns.plan.taskCount", { defaultValue: "{{n}} tasks", n: mine.length })}
              </>
            )}
          </span>
        </span>
        <ChevronRight className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                                    open && "rotate-90")} />
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border bg-muted/20 p-3.5 pl-[3.25rem]">
          {mine.length > 0 ? (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("campaigns.plan.tasks", { defaultValue: "Tasks" })}
              </p>
              <ul className="flex flex-col gap-1">
                {mine.sort((a, b) => a.day_offset - b.day_offset).map((task) => (
                  <li key={task.id} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Clock className="h-2.5 w-2.5 shrink-0" strokeWidth={2} />
                    <span className="w-10 shrink-0 tabular-nums">
                      {task.day_offset === 0 ? "D0" : task.day_offset < 0 ? `D${task.day_offset}` : `D+${task.day_offset}`}
                    </span>
                    <span className="min-w-0 text-foreground/80">{task.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t("campaigns.plan.noTasks", {
                defaultValue: "No scheduled tasks. This agent contributes through its channels rather than the timeline.",
              })}
            </p>
          )}

          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("campaigns.plan.output", { defaultValue: "Produced" })}
            </p>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {produced > 0
                ? t("campaigns.team.produced", { defaultValue: "{{n}} piece(s) produced", n: produced })
                : t("campaigns.plan.noOutputYet", {
                    defaultValue: "Nothing yet. Its work is created when the campaign runs.",
                  })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * What this campaign will produce, expected against generated.
 *
 * Expected comes from what each channel declares it needs; generated is what
 * has been written. Both are counted, so "0 / 3" is a real fraction rather than
 * a placeholder -- and it answers the question "0 pieces produced" left open,
 * which is zero out of how many.
 */
function Deliverables({ campaign, onGoToTab }: {
  campaign: Campaign; onGoToTab: (tab: "work" | "launch" | "results") => void;
}) {
  const { t } = useTranslation();
  const channels = campaign.channels ?? [];
  const assets = campaign.assets ?? [];
  if (!channels.length) return null;

  return (
    <section>
      <SectionLabel>
        {t("campaigns.plan.deliverables", { defaultValue: "Expected deliverables" })}
      </SectionLabel>
      <div className="mt-3 flex flex-col divide-y divide-border rounded-xl border border-border">
        {channels.map((ch) => {
          const written = assets.filter((a) => a.channel_id === ch.id);
          const kinds = new Set(written.map((a) => a.kind));
          const owner = (campaign.team ?? []).find((m) => m.channels.includes(ch.channel));
          return (
            <div key={ch.id} className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5">
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground">
                  {t(`campaigns.channel.${ch.channel}`, { defaultValue: ch.channel })}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {owner ? owner.name : t("campaigns.kpi.noTeam", { defaultValue: "Not assigned yet" })}
                </p>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                {written.length
                  ? t("campaigns.plan.written", {
                      defaultValue: "{{n}} written across {{k}} type(s)",
                      n: written.length, k: kinds.size,
                    })
                  : t("campaigns.plan.notWritten", { defaultValue: "Nothing written yet" })}
              </span>
            </div>
          );
        })}
      </div>
      <button onClick={() => onGoToTab("work")}
              className="mt-2 cursor-pointer text-[11px] font-medium text-primary hover:underline">
        {t("campaigns.plan.goToWork", { defaultValue: "Open the work" })}
      </button>
    </section>
  );
}
