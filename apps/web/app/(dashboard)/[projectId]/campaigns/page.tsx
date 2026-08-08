"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import {
  AlertTriangle, Archive, CalendarDays, Lightbulb, Megaphone, MoreHorizontal,
  Plus, Search, Sparkles, Trash2, X,
} from "lucide-react";
import {
  campaignCalendar, campaignLearnings, campaignOverview, campaignPersona,
  deleteCampaign, listCampaigns, setCampaignStatus, type Campaign,
} from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { STATUS_ORDER, STATUS_RAIL, statusBadgeClass } from "@/lib/campaignStatus";
import { Metric, Section, Unavailable, money } from "@/components/campaigns/CampaignPrimitives";
import { CreateCampaign } from "@/components/campaigns/CreateCampaign";

/**
 * The campaign command centre.
 *
 * WHAT LEADS. Attributed revenue and orders, because they are the only campaign
 * figures in the product that are measured rather than modelled -- they come
 * from real orders whose landing URL carried the campaign's tag. Counts of
 * campaigns by status sit underneath as navigation, not as achievement: "12
 * campaigns" is the vanity metric this dashboard is specifically meant to avoid.
 *
 * WHAT IS ABSENT. ROAS, CAC, CTR, spend. Not as empty cards -- as a single
 * grouped note naming the connector that would fill them. A dashboard that
 * renders unmeasured metrics as zeros teaches people to distrust the measured
 * ones next to them.
 */

type View = "campaigns" | "calendar" | "learnings";

export default function CampaignsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();

  const [view, setView] = useState<View>("campaigns");
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("");

  const { data: overview } = useQuery({
    queryKey: ["campaign-overview", projectId],
    queryFn: () => campaignOverview(projectId),
    staleTime: 30_000,
  });

  // A campaign is work produced by a combination of agents. Whether that work
  // is judged in revenue depends entirely on what this project is: a creator
  // has no orders to attribute, so leading with "0.00 attributed revenue"
  // reports a failure that never had a way to succeed.
  const { data: persona } = useQuery({
    queryKey: ["campaign-persona", projectId],
    queryFn: () => campaignPersona(projectId),
    staleTime: 600_000,
  });
  const sells = persona?.measuresRevenue ?? overview?.judged_on_revenue ?? false;

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns", projectId, statusFilter],
    queryFn: () => listCampaigns(projectId, { status: statusFilter || undefined }),
    staleTime: 15_000,
  });

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return campaigns;
    return campaigns.filter((c) =>
      c.name.toLowerCase().includes(needle) || c.goal.toLowerCase().includes(needle));
  }, [campaigns, query]);

  const currency = "EUR";

  return (
    <div className="flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
            <Megaphone className="h-5 w-5 text-primary" strokeWidth={2} />
            {t("campaigns.title", { defaultValue: "Campaigns" })}
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {t("campaigns.subtitle", {
              defaultValue: "One brief, a team of agents, one piece of work.",
            })}
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t("campaigns.createWithAi", { defaultValue: "Create campaign with AI" })}
        </button>
      </header>

      <Card className="p-5">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {sells ? (
            <>
              <Metric
                label={t("campaigns.kpi.revenue", { defaultValue: "Attributed revenue" })}
                value={money(overview?.revenue ?? 0, currency)}
                sub={t("campaigns.kpi.revenueSub", {
                  defaultValue: "from orders carrying a campaign tag",
                })}
              />
              <Metric
                label={t("campaigns.kpi.orders", { defaultValue: "Attributed orders" })}
                value={String(overview?.orders ?? 0)}
                sub={t("campaigns.kpi.attributedIn", {
                  defaultValue: "across {{n}} campaign(s)",
                  n: overview?.campaigns_with_attributed_orders ?? 0,
                })}
              />
              <Metric
                label={t("campaigns.kpi.aov", { defaultValue: "Average order value" })}
                value={money(overview?.aov ?? 0, currency)}
              />
              <Metric
                label={t("campaigns.kpi.budget", { defaultValue: "Planned budget" })}
                value={money(overview?.budget ?? null, currency)}
                tone="muted"
                sub={overview?.revenue_vs_budget != null
                  ? t("campaigns.kpi.vsBudget", {
                      defaultValue: "{{x}}x revenue vs planned budget — not ROAS",
                      x: overview.revenue_vs_budget,
                    })
                  : undefined}
              />
            </>
          ) : (
            <>
              <Metric
                label={t("campaigns.kpi.live", { defaultValue: "Live campaigns" })}
                value={String((overview?.by_status?.running ?? 0) + (overview?.by_status?.scheduled ?? 0))}
              />
              <Metric
                label={t("campaigns.kpi.inProgress", { defaultValue: "In preparation" })}
                value={String((overview?.by_status?.planning ?? 0) + (overview?.by_status?.draft ?? 0)
                              + (overview?.by_status?.ready ?? 0))}
              />
              <Metric
                label={t("campaigns.kpi.done", { defaultValue: "Completed" })}
                value={String(overview?.by_status?.completed ?? 0)}
              />
              <Metric
                label={t("campaigns.kpi.total", { defaultValue: "All campaigns" })}
                value={String(overview?.total ?? 0)}
                tone="muted"
              />
            </>
          )}
        </div>
        {/* Says what this project is judged on, so an absent revenue figure
            reads as "not the point" rather than as a zero. */}
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          {/* Translated from the outcome key, not from the API's sentence:
              prose composed on the server cannot know the reader's language. */}
          {t(`campaigns.measuredBy.${persona?.outcome ?? overview?.outcome ?? "content"}`,
             { defaultValue: persona?.measuredBy ?? overview?.measured_by ?? "" })}
        </p>
        {sells && overview?.unavailable?.length ? (
          <Unavailable metrics={overview.unavailable} className="mt-4" />
        ) : null}
      </Card>

      <nav className="flex items-center gap-1 border-b border-border">
        {([
          ["campaigns", Megaphone, t("campaigns.view.list", { defaultValue: "Campaigns" })],
          ["calendar", CalendarDays, t("campaigns.view.calendar", { defaultValue: "Calendar" })],
          ["learnings", Lightbulb, t("campaigns.view.learnings", { defaultValue: "What we learned" })],
        ] as const).map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            aria-current={view === key ? "page" : undefined}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors",
              view === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            {label}
          </button>
        ))}
      </nav>

      {view === "campaigns" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("campaigns.search", { defaultValue: "Search campaigns" })}
                aria-label={t("campaigns.search", { defaultValue: "Search campaigns" })}
                className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
              {query && (
                <button onClick={() => setQuery("")} aria-label={t("common.clear", { defaultValue: "Clear" })}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <FilterChip active={!statusFilter} onClick={() => setStatusFilter("")}
                          label={t("campaigns.filter.all", { defaultValue: "All" })}
                          count={overview?.total} />
              {STATUS_ORDER.filter((s) => (overview?.by_status?.[s] ?? 0) > 0).map((s) => (
                <FilterChip key={s} active={statusFilter === s} onClick={() => setStatusFilter(s)}
                            label={t(`campaigns.status.${s}`, { defaultValue: s })}
                            count={overview?.by_status?.[s]} />
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-[74px] animate-pulse rounded-xl border border-border bg-muted/30" />
              ))}
            </div>
          ) : !shown.length ? (
            <EmptyState onCreate={() => setCreating(true)} hasAny={(overview?.total ?? 0) > 0}
                        sells={sells} />
          ) : (
            <div className="flex flex-col gap-2">
              {shown.map((c) => <CampaignCard key={c.id} campaign={c} projectId={projectId} sells={sells} />)}
            </div>
          )}
        </>
      )}

      {view === "calendar" && <CalendarView projectId={projectId} />}
      {view === "learnings" && <LearningsView projectId={projectId} />}

      {creating && <CreateCampaign projectId={projectId} onClose={() => setCreating(false)} />}
    </div>
  );
}

function FilterChip({ label, count, active, onClick }: {
  label: string; count?: number; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active ? "border-foreground/20 bg-foreground/5 text-foreground"
               : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {count !== undefined && <span className="ml-1 tabular-nums opacity-60">{count}</span>}
    </button>
  );
}

function CampaignCard({ campaign: c, projectId, sells }: {
  campaign: Campaign; projectId: string; sells: boolean;
}) {
  const { t } = useTranslation();
  const revenue = c.performance?.revenue ?? 0;
  const orders = c.performance?.orders ?? 0;
  const live = c.status === "running" || c.status === "scheduled";

  return (
    <Link
      href={`/${projectId}/campaigns/${c.id}`}
      className="group relative flex items-stretch gap-0 rounded-xl border border-border bg-card transition-colors hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* A status rail rather than a badge in the corner: state is the thing you
          scan a list for, and colour down the edge reads at a glance without
          spending a word. */}
      <span aria-hidden
            className={cn("w-1 shrink-0 rounded-l-xl", STATUS_RAIL[c.status] ?? "bg-border")} />

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 p-3.5">
        <div className="min-w-[180px] flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{c.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span className={cn("font-medium", live && "text-primary")}>
              {t(`campaigns.status.${c.status}`, { defaultValue: c.status })}
            </span>
            {c.objective && (
              <>
                <span aria-hidden>·</span>
                {t(`campaigns.objective.${c.objective}`, { defaultValue: c.objective })}
              </>
            )}
            {c.starts_on && (<><span aria-hidden>·</span>{c.starts_on}</>)}
          </p>
        </div>

        {/* Who is doing it. On a list of campaigns this is the question the
            feature is about, so it sits in the row rather than one level in. */}
        {c.team?.length ? (
          <div className="hidden min-w-[120px] shrink-0 flex-col gap-0.5 sm:flex">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {t("campaigns.kpi.team", { defaultValue: "Team" })}
            </span>
            <span className="truncate text-[11px] text-foreground">
              {c.team.map((m) => m.name).slice(0, 2).join(", ")}
              {c.team.length > 2 && ` +${c.team.length - 2}`}
            </span>
          </div>
        ) : null}

        {c.channels?.length ? (
          <div className="hidden shrink-0 flex-wrap gap-1 md:flex">
            {c.channels.slice(0, 3).map((ch) => (
              <span key={ch.id}
                    className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t(`campaigns.channel.${ch.channel}`, { defaultValue: ch.channel })}
              </span>
            ))}
            {c.channels.length > 3 && (
              <span className="self-center text-[10px] text-muted-foreground">
                +{c.channels.length - 3}
              </span>
            )}
          </div>
        ) : null}

        <CampaignMenu campaign={c} projectId={projectId} />

        <div className="shrink-0 text-right">
          {sells ? (
            <>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {money(revenue, c.budget.currency ?? "EUR")}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("campaigns.ordersCount", { defaultValue: "{{n}} orders", n: orders })}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {c.team?.reduce((n, m) => n + m.produced, 0) ?? 0}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("campaigns.work.piecesShort", { defaultValue: "pieces" })}
              </p>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * Archive or delete, from the list.
 *
 * Neither existed anywhere in the product: a campaign could be created and
 * never removed, so the list only ever grew. Archive is offered first because
 * it is the reversible one -- delete asks for confirmation and says what goes
 * with it, since channels, content, timeline and approvals go too.
 */
function CampaignMenu({ campaign: c, projectId }: { campaign: Campaign; projectId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["campaigns", projectId] });
    qc.invalidateQueries({ queryKey: ["campaign-overview", projectId] });
    setOpen(false);
    setConfirming(false);
  }
  const archive = useMutation({
    mutationFn: () => setCampaignStatus(c.id, c.status === "archived" ? "ready" : "archived"),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => deleteCampaign(c.id),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <span className={cn("shrink-0", open ? "static" : "relative")}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={t("campaigns.manage", { defaultValue: "Manage campaign" })}
        aria-expanded={open}
        className="cursor-pointer rounded-lg p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus:opacity-100 group-hover:opacity-100"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="popover animate-scale-in absolute right-3 top-12 z-50 w-60 rounded-xl border border-border bg-card p-1.5 shadow-lg">
          <button onClick={() => archive.mutate()} disabled={archive.isPending}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-foreground hover:bg-muted disabled:opacity-50">
            <Archive className="h-3 w-3 shrink-0 text-muted-foreground" />
            {c.status === "archived"
              ? t("campaigns.unarchive", { defaultValue: "Restore from archive" })
              : t("campaigns.archive", { defaultValue: "Archive" })}
          </button>
          {!confirming ? (
            <button onClick={() => setConfirming(true)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-destructive hover:bg-destructive/10">
              <Trash2 className="h-3 w-3 shrink-0" />
              {t("campaigns.delete", { defaultValue: "Delete" })}
            </button>
          ) : (
            <div className="rounded-lg bg-destructive/5 p-2">
              {/* Names what goes, rather than asking "are you sure". */}
              <p className="text-[11px] leading-relaxed text-foreground">
                {t("campaigns.deleteConfirm", {
                  defaultValue: "Delete this campaign, its channels, content, timeline and approvals? What it taught you is kept.",
                })}
              </p>
              <div className="mt-2 flex gap-1.5">
                <button onClick={() => remove.mutate()} disabled={remove.isPending}
                        className="cursor-pointer rounded-lg bg-destructive px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-destructive/90 disabled:opacity-50">
                  {t("campaigns.deleteYes", { defaultValue: "Delete it" })}
                </button>
                <button onClick={() => setConfirming(false)}
                        className="cursor-pointer rounded-lg px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">
                  {t("common.cancel", { defaultValue: "Cancel" })}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </span>
  );
}

function EmptyState({ onCreate, hasAny, sells }: {
  onCreate: () => void; hasAny: boolean; sells: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
      <Megaphone className="h-6 w-6 text-muted-foreground" strokeWidth={1.6} />
      <p className="text-sm font-medium text-foreground">
        {hasAny
          ? t("campaigns.empty.filtered", { defaultValue: "No campaign matches that." })
          : t("campaigns.empty.title", { defaultValue: "No campaigns yet" })}
      </p>
      {!hasAny && (
        <>
          <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
            {/* A creator is not selling more of anything. Same feature, but the
                sentence has to describe their work, not a shop's. */}
            {sells
              ? t("campaigns.empty.bodySells", {
                  defaultValue: "Say what you want to sell more of. Fennex reads your store, then a team of agents builds the strategy, audience, offer, content and tracking around it.",
                })
              : t("campaigns.empty.body", {
                  defaultValue: "Say what you want to achieve. A team of agents plans it, writes it, and produces the work across every channel you use.",
                })}
          </p>
          <button onClick={onCreate}
                  className="mt-1 flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
            <Plus className="h-3.5 w-3.5" />
            {t("campaigns.createWithAi", { defaultValue: "Create campaign with AI" })}
          </button>
        </>
      )}
    </div>
  );
}

function CalendarView({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["campaign-calendar", projectId],
    queryFn: () => campaignCalendar(projectId),
    staleTime: 60_000,
  });

  if (!data) return <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/30" />;

  return (
    <div className="flex flex-col gap-4">
      {data.conflicts.length > 0 && (
        <Section title={t("campaigns.calendar.conflicts", { defaultValue: "Overlaps worth knowing about" })}
                 description={t("campaigns.calendar.conflictsHint", {
                   defaultValue: "Two campaigns aiming at the same audience on the same days compete for the same inbox.",
                 })}>
          <ul className="flex flex-col gap-2">
            {data.conflicts.map((c, i) => (
              <li key={i} className="flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/5 p-3">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={2} />
                <div className="min-w-0 text-xs leading-relaxed">
                  <p className="font-medium text-foreground">{c.names.join("  ·  ")}</p>
                  <p className="text-muted-foreground">{c.message} {c.from} → {c.to}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title={t("campaigns.calendar.title", { defaultValue: "Scheduled" })}>
        {!data.entries.length ? (
          <p className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
            {t("campaigns.calendar.empty", { defaultValue: "Nothing scheduled. A campaign appears here once it has a start date." })}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.entries.map((e) => (
              <li key={e.id}>
                <Link href={`/${projectId}/campaigns/${e.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 transition-colors hover:border-foreground/15">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground">{e.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {e.starts_on} {e.ends_on ? `→ ${e.ends_on}` : ""}
                      {e.tasks.length ? `  ·  ${t("campaigns.calendar.tasks", { defaultValue: "{{n}} tasks", n: e.tasks.length })}` : ""}
                    </p>
                  </div>
                  <span className={statusBadgeClass(e.status)}>
                    {t(`campaigns.status.${e.status}`, { defaultValue: e.status })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function LearningsView({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const { data = [] } = useQuery({
    queryKey: ["campaign-learnings", projectId],
    queryFn: () => campaignLearnings(projectId),
    staleTime: 120_000,
  });

  const CONFIDENCE: Record<string, string> = {
    high: "bg-success/12 text-success",
    medium: "bg-primary/12 text-primary",
    low: "bg-muted text-muted-foreground",
  };

  return (
    <Section
      title={t("campaigns.learnings.title", { defaultValue: "What your campaigns have established" })}
      description={t("campaigns.learnings.subtitle", {
        defaultValue: "Written when a campaign closes, and read by the next one's strategy. Confidence is capped at the evidence behind it.",
      })}
    >
      {!data.length ? (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
          {t("campaigns.learnings.empty", {
            defaultValue: "Nothing yet. Learnings are recorded when a campaign finishes and its results are reported.",
          })}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((l) => (
            <li key={l.id} className="rounded-xl border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs leading-relaxed text-foreground">{l.statement}</p>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                    CONFIDENCE[l.confidence] ?? CONFIDENCE.low)}>
                  {t(`campaigns.confidence.${l.confidence}`, { defaultValue: l.confidence })}
                </span>
              </div>
              {typeof l.evidence?.note === "string" && l.evidence.note && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {l.evidence.note as string}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
