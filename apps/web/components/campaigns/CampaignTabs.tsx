"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Check, Copy, Loader2, Plug, Plus, RefreshCw, Send, Sparkles, Trash2, Wand2, X,
} from "lucide-react";
import {
  addCampaignChannel, analyseCampaign, campaignChannels, campaignPerformance,
  campaignReadiness, campaignScore, campaignSignals, campaignTracking,
  decideCampaignApproval, deleteCampaignTask, generateCampaignContent,
  deleteCampaignAsset, launchCampaign, patchCampaignAsset, patchCampaignChannel,
  refineCampaignAsset, removeCampaignChannel, saveCampaignTask, sendCampaignForReview,
  type Campaign, type CampaignAsset, type ChannelInfo,
} from "@/lib/api";
import { listEmployees } from "@/lib/employees";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { Sparkline } from "@/components/ui/Sparkline";
import { AlertTriangle } from "lucide-react";
import { employeeIcon } from "@/lib/employees";
import { CheckRow, Metric, Section, Unavailable, money } from "./CampaignPrimitives";

/** The refinements the studio offers. Mirrors REFINEMENTS on the API side. */
const REFINEMENTS = ["improve", "shorten", "premium", "emotional", "direct", "playful"] as const;

function useRefresh(campaignId: string, projectId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["campaign", campaignId] });
    qc.invalidateQueries({ queryKey: ["campaign-readiness", campaignId] });
    qc.invalidateQueries({ queryKey: ["campaigns", projectId] });
  };
}

// ── channels and content ─────────────────────────────────────────────────────

export function ChannelsTab({ campaign, projectId }: { campaign: Campaign; projectId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const refresh = useRefresh(campaign.id, projectId);
  const rows = campaign.channels ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null);
  const [adding, setAdding] = useState(false);

  const { data: catalogue = [] } = useQuery({
    queryKey: ["campaign-channels", projectId],
    queryFn: () => campaignChannels(projectId),
    staleTime: 120_000,
  });

  const add = useMutation({
    mutationFn: (channel: string) => addCampaignChannel(campaign.id, channel),
    onSuccess: (row) => { refresh(); setAdding(false); setSelectedId(row.id); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => removeCampaignChannel(campaign.id, id),
    onSuccess: () => { refresh(); setSelectedId(null); },
    onError: (e: Error) => toast.error(e.message),
  });

  const onCampaign = new Set(rows.map((c) => c.channel));
  const available = catalogue.filter((c) => !onCampaign.has(c.key));
  const selected = rows.find((r) => r.id === selectedId) ?? rows[0] ?? null;
  const assets = (campaign.assets ?? []);

  if (!rows.length) {
    return (
      <Section title={t("campaigns.channels.title", { defaultValue: "Channels" })}>
        <AddChannel available={available} onAdd={(k) => add.mutate(k)} busy={add.isPending} open />
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
          {t("campaigns.channels.empty", {
            defaultValue: "No channels yet. A campaign needs at least one to launch.",
          })}
        </p>
      </Section>
    );
  }

  return (
    /* A list of stacked cards made every channel compete for the same space and
       buried the content inside collapsed sections. This is a workspace: pick a
       channel on the left, work on it on the right. The left rail also shows
       who owns each channel and how much is written, so the next thing to do is
       visible without opening anything. */
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <aside className="flex flex-col gap-2">
        {rows.map((row) => {
          const info = catalogue.find((c) => c.key === row.channel);
          const owner = (campaign.team ?? []).find((m) => m.channels.includes(row.channel));
          const OwnerIcon = employeeIcon(owner?.icon ?? "");
          const written = assets.filter((a) => a.channel_id === row.id).length;
          const active = selected?.id === row.id;
          return (
            <button
              key={row.id}
              onClick={() => setSelectedId(row.id)}
              aria-current={active ? "true" : undefined}
              className={cn(
                "cursor-pointer rounded-xl border p-3 text-left transition-colors",
                active ? "border-primary/40 bg-primary/5" : "border-border hover:border-foreground/15",
              )}
            >
              <p className="flex items-center justify-between gap-2 text-xs font-semibold text-foreground">
                {t(`campaigns.channel.${row.channel}`, { defaultValue: info?.label ?? row.channel })}
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full",
                                    info?.executable ? "bg-success" : "bg-muted-foreground/40")} />
              </p>
              {owner && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <OwnerIcon className="h-2.5 w-2.5" strokeWidth={2.2} />
                  {owner.name}
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted-foreground">
                {written
                  ? t("campaigns.content.count", { defaultValue: "{{n}} pieces", n: written })
                  : t("campaigns.content.none", { defaultValue: "Nothing written" })}
              </p>
            </button>
          );
        })}
        <button onClick={() => setAdding((v) => !v)}
                className="flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-dashed border-border p-2.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
          <Plus className="h-3 w-3" />
          {t("campaigns.channels.add", { defaultValue: "Add channel" })}
        </button>
        {adding && <AddChannel available={available} onAdd={(k) => add.mutate(k)} busy={add.isPending} open />}
      </aside>

      {selected && (
        <ChannelWorkspace
          key={selected.id}
          campaign={campaign}
          projectId={projectId}
          row={selected}
          info={catalogue.find((c) => c.key === selected.channel)}
          onRemove={() => remove.mutate(selected.id)}
        />
      )}
    </div>
  );
}

function AddChannel({ available, onAdd, busy, open }: {
  available: { key: string; label: string; executable: boolean; manualOnly: boolean }[];
  onAdd: (key: string) => void; busy: boolean; open?: boolean;
}) {
  const { t } = useTranslation();
  if (!open) return null;
  if (!available.length) {
    return (
      <p className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground">
        {t("campaigns.channels.allAdded", { defaultValue: "Every channel is already on this campaign." })}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5 rounded-xl border border-border bg-muted/20 p-2.5">
      {available.map((c) => (
        <button key={c.key} onClick={() => onAdd(c.key)} disabled={busy}
                className="cursor-pointer rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] text-foreground hover:border-foreground/20 disabled:opacity-50">
          {t(`campaigns.channel.${c.key}`, { defaultValue: c.label })}
          {!c.executable && (
            <span className="ml-1.5 text-muted-foreground">
              {c.manualOnly
                ? t("campaigns.channels.manual", { defaultValue: "manual" })
                : t("campaigns.channels.notConnected", { defaultValue: "not connected" })}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function ChannelWorkspace({ campaign, projectId, row, info, onRemove }: {
  campaign: Campaign; projectId: string;
  row: NonNullable<Campaign["channels"]>[number];
  info?: ChannelInfo;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const refresh = useRefresh(campaign.id, projectId);
  const assets = (campaign.assets ?? []).filter((a) => a.channel_id === row.id);
  const owner = (campaign.team ?? []).find((m) => m.channels.includes(row.channel));
  const OwnerIcon = employeeIcon(owner?.icon ?? "");

  // One kind at a time. Six kinds x three variants on one screen is eighteen
  // blocks of prose nobody reads; a person is choosing a headline OR a subject
  // line, never both at once.
  const kinds = info?.contentKinds ?? [];
  const written = new Set(assets.map((a) => a.kind));
  const [kind, setKind] = useState<string>(kinds.find((k) => written.has(k)) ?? kinds[0] ?? "");

  const generate = useMutation({
    mutationFn: (only: string[]) => generateCampaignContent(campaign.id, row.id, only),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const shown = assets.filter((a) => a.kind === kind);
  const missing = kinds.filter((k) => !written.has(k));

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card className="flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">
            {t(`campaigns.channel.${row.channel}`, { defaultValue: info?.label ?? row.channel })}
            {row.role && (
              <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                {t(`campaigns.role.${row.role}`, { defaultValue: row.role })}
              </span>
            )}
            <OwnerPicker campaign={campaign} projectId={projectId} row={row}
                         currentId={owner?.id ?? (row.config as { owner?: string } | null)?.owner ?? null} />
          </h3>
          <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Plug className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={2} />
            {info?.executable
              ? t("campaigns.channels.via", { defaultValue: "Publishes through {{app}}", app: info.executor })
              : info?.manualOnly
                ? t("campaigns.channels.manualHint", { defaultValue: "Fennex writes it; you send it" })
                : t("campaigns.channels.connectHint", {
                    defaultValue: "Content is prepared. Connect {{apps}} to publish automatically.",
                    apps: (info?.connectOneOf ?? []).map((a) => a.label).join(" or "),
                  })}
          </p>
        </div>
        <button onClick={onRemove} aria-label={t("common.remove", { defaultValue: "Remove" })}
                className="cursor-pointer rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </Card>

      {kinds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {kinds.map((k) => (
            <button
              key={k}
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={cn(
                "flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-colors",
                kind === k ? "border-foreground/25 bg-foreground/5 text-foreground"
                           : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`campaigns.kind.${k}`, { defaultValue: k.replace(/_/g, " ") })}
              {/* A filled dot means it exists. The empty ones are the work left. */}
              <span className={cn("h-1.5 w-1.5 rounded-full",
                                  written.has(k) ? "bg-success" : "bg-muted-foreground/30")} />
            </button>
          ))}
          {missing.length > 0 && (
            <button onClick={() => generate.mutate(missing)} disabled={generate.isPending}
                    className="ml-auto flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {generate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
              {t("campaigns.content.writeMissing", {
                defaultValue: "Write the {{n}} missing", n: missing.length,
              })}
            </button>
          )}
        </div>
      )}

      {!shown.length ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-12 text-center">
          <p className="text-xs text-muted-foreground">
            {t("campaigns.content.emptyKind", {
              defaultValue: "Nothing written for this yet.",
            })}
          </p>
          <button onClick={() => generate.mutate([kind])} disabled={generate.isPending || !kind}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {generate.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
            {owner
              ? t("campaigns.content.askOwner", { defaultValue: "Ask {{name}} to write it", name: owner.name })
              : t("campaigns.content.write", { defaultValue: "Write content" })}
          </button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          {shown.map((a) => (
            <VariantCard key={a.id} asset={a} campaign={campaign} projectId={projectId} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One variant, as a card you can compare against its siblings side by side.
 *
 * The previous row layout made three options a vertical list, which is the one
 * shape that makes comparison hard -- you cannot see B while reading C. Three
 * columns is how a person actually picks between them.
 */
/**
 * Which agent does this channel's work.
 *
 * The assignment existed and was invisible, so the campaign looked like it
 * wrote itself. Every agent in the roster is offered -- "make available agents"
 * means the whole team is reachable, not the one the planner happened to pick.
 * Changing it changes who writes the copy, because the owner's brief is what
 * shapes the generation.
 */
function OwnerPicker({ campaign, projectId, row, currentId }: {
  campaign: Campaign; projectId: string;
  row: NonNullable<Campaign["channels"]>[number];
  currentId: string | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const refresh = useRefresh(campaign.id, projectId);
  const [open, setOpen] = useState(false);

  const { data: registry } = useQuery({
    queryKey: ["employees"], queryFn: () => listEmployees(), staleTime: 300_000,
  });
  const agents = registry?.employees ?? [];
  const current = agents.find((a) => a.id === currentId);
  const CurrentIcon = employeeIcon(current?.icon ?? "");

  const assign = useMutation({
    mutationFn: (employeeId: string) => patchCampaignChannel(campaign.id, row.id, {
      channel: row.channel,
      config: { ...(row.config ?? {}), owner: employeeId },
    }),
    onSuccess: () => { refresh(); setOpen(false); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <span className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex cursor-pointer items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/15"
      >
        <CurrentIcon className="h-2.5 w-2.5" strokeWidth={2.2} />
        {current
          ? t("campaigns.channels.ownedBy", { defaultValue: "{{name}} writes this", name: current.name })
          : t("campaigns.channels.assign", { defaultValue: "Assign an agent" })}
      </button>
      {open && (
        <div className="popover animate-scale-in absolute left-0 top-6 z-20 w-56 rounded-xl border border-border bg-card p-1.5 shadow-lg">
          {agents.map((a) => {
            const Icon = employeeIcon(a.icon);
            return (
              <button
                key={a.id}
                onClick={() => assign.mutate(a.id)}
                disabled={assign.isPending}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-muted",
                  a.id === currentId && "bg-muted",
                )}
              >
                <Icon className="h-3 w-3 shrink-0 text-primary" strokeWidth={2} />
                <span className="min-w-0">
                  <span className="block truncate font-medium text-foreground">{a.name}</span>
                  <span className="block truncate text-muted-foreground">{a.role}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

function VariantCard({ asset, campaign, projectId }: {
  asset: CampaignAsset; campaign: Campaign; projectId: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const refresh = useRefresh(campaign.id, projectId);
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  const refine = useMutation({
    mutationFn: (action: string) => refineCampaignAsset(campaign.id, asset.id, action),
    onSuccess: () => { refresh(); setMenu(false); },
    onError: (e: Error) => toast.error(e.message),
  });
  const choose = useMutation({
    mutationFn: () => patchCampaignAsset(campaign.id, asset.id, { selected: !asset.selected }),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const drop = useMutation({
    mutationFn: () => deleteCampaignAsset(campaign.id, asset.id),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  async function copy() {
    await navigator.clipboard.writeText(asset.body ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card className={cn("flex flex-col gap-2.5 p-3.5 transition-colors",
                        asset.selected ? "border-primary/40 bg-primary/5" : "")}>
      <div className="flex items-center justify-between gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
          {asset.variant}
        </span>
        <div className="flex items-center gap-0.5">
          <button onClick={copy} aria-label={t("common.copy", { defaultValue: "Copy" })}
                  className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground">
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          </button>
          <button onClick={() => setMenu((v) => !v)}
                  aria-label={t("campaigns.content.refine", { defaultValue: "Refine" })}
                  className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground">
            {refine.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          </button>
          <button onClick={() => drop.mutate()} aria-label={t("common.remove", { defaultValue: "Remove" })}
                  className="cursor-pointer rounded p-1 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <p className="min-h-[3.5rem] text-xs leading-relaxed text-foreground">{asset.body}</p>

      {menu && (
        <div className="flex flex-wrap gap-1 border-t border-border pt-2">
          {REFINEMENTS.map((r) => (
            <button key={r} onClick={() => refine.mutate(r)} disabled={refine.isPending}
                    className="cursor-pointer rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50">
              {t(`campaigns.refine.${r}`, { defaultValue: r })}
            </button>
          ))}
        </div>
      )}

      <button onClick={() => choose.mutate()}
              className={cn("mt-auto cursor-pointer rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                            asset.selected
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground")}>
        {asset.selected
          ? t("campaigns.content.chosen", { defaultValue: "Chosen" })
          : t("campaigns.content.choose", { defaultValue: "Use this one" })}
      </button>
    </Card>
  );
}

// ── timeline ─────────────────────────────────────────────────────────────────

export function TimelineTab({ campaign, projectId }: { campaign: Campaign; projectId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const refresh = useRefresh(campaign.id, projectId);
  const [title, setTitle] = useState("");
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      saveCampaignTask(campaign.id, body, id),
    onSuccess: () => { refresh(); setTitle(""); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteCampaignTask(campaign.id, id),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });

  const tasks = [...(campaign.tasks ?? [])].sort((a, b) => a.day_offset - b.day_offset);
  const start = campaign.starts_on ? new Date(campaign.starts_on) : null;
  const team = campaign.team ?? [];

  // The track spans the work, not a fixed window: a campaign that starts
  // planning three weeks out should not be squeezed into the same span as one
  // that starts on Monday.
  const first = Math.min(-7, ...tasks.map((x) => x.day_offset));
  const last = Math.max(7, ...tasks.map((x) => x.day_offset));
  const days = Array.from({ length: last - first + 1 }, (_, i) => first + i);

  function dayLabel(d: number) {
    if (d === 0) return t("campaigns.timeline.launch", { defaultValue: "Launch" });
    return d < 0 ? `D${d}` : `D+${d}`;
  }
  function dateFor(d: number) {
    if (!start) return "";
    const when = new Date(start);
    when.setDate(when.getDate() + d);
    return when.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  function move(taskId: string, day: number, currentTitle: string) {
    save.mutate({ id: taskId, body: { title: currentTitle, day_offset: day } });
  }

  const byDay = new Map<number, typeof tasks>();
  for (const task of tasks) {
    byDay.set(task.day_offset, [...(byDay.get(task.day_offset) ?? []), task]);
  }

  return (
    <Section
      title={t("campaigns.timeline.title", { defaultValue: "Timeline" })}
      description={t("campaigns.timeline.subtitle", {
        defaultValue: "Days relative to launch, so the plan holds whenever you start. Drag a step to move it.",
      })}
    >
      {/* A horizontal track with launch as the anchor. The previous version was
          a vertical list where every row carried a 41-option dropdown, which is
          neither a timeline nor a usable control -- you could not see the shape
          of the campaign, only its rows. */}
      <div className="overflow-x-auto rounded-xl border border-border bg-muted/10 p-4">
        <div className="flex min-w-max gap-1">
          {days.map((d) => {
            const here = byDay.get(d) ?? [];
            const isLaunch = d === 0;
            return (
              <div
                key={d}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  const task = tasks.find((x) => x.id === id);
                  if (task && task.day_offset !== d) move(task.id, d, task.title);
                  setDragging(null);
                }}
                className={cn(
                  "flex w-[132px] shrink-0 flex-col gap-1.5 rounded-lg p-1.5 transition-colors",
                  isLaunch && "bg-primary/5 ring-1 ring-primary/25",
                  dragging && "outline-dashed outline-1 outline-border",
                )}
              >
                <div className="px-1">
                  <p className={cn("text-[11px] font-semibold tabular-nums",
                                   isLaunch ? "text-primary" : "text-muted-foreground")}>
                    {dayLabel(d)}
                  </p>
                  {start && <p className="text-[10px] text-muted-foreground">{dateFor(d)}</p>}
                </div>

                {here.map((task) => {
                  const owner = team.find((m) => m.id === task.owner);
                  const OwnerIcon = employeeIcon(owner?.icon ?? "");
                  return (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", task.id); setDragging(task.id); }}
                      onDragEnd={() => setDragging(null)}
                      className={cn(
                        "group cursor-grab rounded-lg border border-border bg-card p-2 active:cursor-grabbing",
                        dragging === task.id && "opacity-40",
                      )}
                    >
                      <p className="text-[11px] leading-snug text-foreground">{task.title}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-1">
                        {owner ? (
                          <span className="flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
                            <OwnerIcon className="h-2.5 w-2.5 shrink-0" strokeWidth={2.2} />
                            <span className="truncate">{owner.name}</span>
                          </span>
                        ) : <span />}
                        <button
                          onClick={() => remove.mutate(task.id)}
                          aria-label={t("common.remove", { defaultValue: "Remove" })}
                          className="shrink-0 cursor-pointer text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                        >
                          <Trash2 className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (title.trim()) save.mutate({ body: { title: title.trim(), day_offset: offset } }); }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("campaigns.timeline.addPlaceholder", { defaultValue: "Add a step" })}
          aria-label={t("campaigns.timeline.addPlaceholder", { defaultValue: "Add a step" })}
          className="min-w-[200px] flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        <div className="flex items-center gap-1.5">
          {/* A stepper, not a 41-option select. Nobody scrolls a dropdown to
              find D-12; they nudge from a sensible starting point. */}
          <button type="button" onClick={() => setOffset((v) => Math.max(-30, v - 1))}
                  aria-label={t("campaigns.timeline.earlier", { defaultValue: "Earlier" })}
                  className="cursor-pointer rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground">
            −
          </button>
          <span className="w-16 text-center text-xs font-semibold tabular-nums text-foreground">
            {dayLabel(offset)}
          </span>
          <button type="button" onClick={() => setOffset((v) => Math.min(30, v + 1))}
                  aria-label={t("campaigns.timeline.later", { defaultValue: "Later" })}
                  className="cursor-pointer rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground">
            +
          </button>
        </div>
        <button type="submit" disabled={!title.trim() || save.isPending}
                className="cursor-pointer rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {t("common.add", { defaultValue: "Add" })}
        </button>
      </form>
    </Section>
  );
}

// ── launch ───────────────────────────────────────────────────────────────────

export function LaunchTab({ campaign, projectId }: { campaign: Campaign; projectId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const refresh = useRefresh(campaign.id, projectId);

  const { data: readiness } = useQuery({
    queryKey: ["campaign-readiness", campaign.id],
    queryFn: () => campaignReadiness(campaign.id),
  });
  const { data: tracking } = useQuery({
    queryKey: ["campaign-tracking", campaign.id],
    queryFn: () => campaignTracking(campaign.id),
    staleTime: 300_000,
  });

  const review = useMutation({ mutationFn: () => sendCampaignForReview(campaign.id),
                               onSuccess: refresh, onError: (e: Error) => toast.error(e.message) });
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      decideCampaignApproval(campaign.id, id, approve),
    onSuccess: refresh, onError: (e: Error) => toast.error(e.message),
  });
  const go = useMutation({
    mutationFn: () => launchCampaign(campaign.id),
    onSuccess: () => { refresh(); toast.success(t("campaigns.launch.done", { defaultValue: "Campaign is live." })); },
    onError: (e: Error) => toast.error(e.message),
  });

  const pending = (campaign.approvals ?? []).filter((a) => a.state === "pending");
  const live = campaign.status === "running";

  return (
    <div className="flex flex-col gap-5">
      <Section
        title={t("campaigns.launch.title", { defaultValue: "Before you launch" })}
        description={t("campaigns.launch.subtitle", {
          defaultValue: "Blockers stop the launch. Warnings do not. Unchecked means Fennex could not look.",
        })}
        action={
          live ? (
            <span className="rounded-full bg-primary/12 px-3 py-1.5 text-[11px] font-semibold text-primary">
              {t("campaigns.status.running", { defaultValue: "Running" })}
            </span>
          ) : (
            <button onClick={() => go.mutate()} disabled={!readiness?.ready || go.isPending}
                    className="flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
              {go.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {t("campaigns.launch.cta", { defaultValue: "Launch campaign" })}
            </button>
          )
        }
      >
        {readiness && (
          <div className="flex flex-col gap-3">
            {/* The verdict, before the detail. */}
            <div className={cn(
              "flex flex-wrap items-center gap-3 rounded-xl border p-4",
              readiness.ready ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5",
            )}>
              {readiness.ready
                ? <Check className="h-5 w-5 shrink-0 text-success" strokeWidth={2.4} />
                : <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" strokeWidth={2.2} />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  {readiness.ready
                    ? t("campaigns.launch.ready", { defaultValue: "Everything is ready" })
                    : t("campaigns.launch.blocked", {
                        defaultValue: "{{n}} thing(s) must be fixed first",
                        n: readiness.blockers.length,
                      })}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {[
                    readiness.warnings.length && t("campaigns.launch.warnCount", {
                      defaultValue: "{{n}} warning(s)", n: readiness.warnings.length }),
                    readiness.unknown.length && t("campaigns.launch.unknownCount", {
                      defaultValue: "{{n}} unchecked", n: readiness.unknown.length }),
                    readiness.passed.length && t("campaigns.launch.passCount", {
                      defaultValue: "{{n}} passed", n: readiness.passed.length }),
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>

            {/* Blockers on their own, because they are the only ones that stop
                the launch. Everything else is folded away by default -- a
                checklist that shows eight passes beside two blockers makes the
                blockers harder to find, not the campaign more reassuring. */}
            {readiness.blockers.length > 0 && (
              <Card className="p-4">
                <ul className="flex flex-col divide-y divide-border">
                  {readiness.blockers.map((item) => <CheckRow key={item.key + item.message} item={item} />)}
                </ul>
              </Card>
            )}

            <details className="group rounded-xl border border-border">
              <summary className="flex cursor-pointer items-center justify-between gap-2 p-3.5 text-xs font-medium text-foreground">
                {t("campaigns.launch.everythingElse", { defaultValue: "Everything else" })}
                <span className="text-[11px] text-muted-foreground transition-transform group-open:rotate-180">▾</span>
              </summary>
              <ul className="flex flex-col divide-y divide-border border-t border-border px-4 pb-2">
                {[...readiness.warnings, ...readiness.unknown, ...readiness.passed]
                  .map((item) => <CheckRow key={item.key + item.message} item={item} />)}
              </ul>
            </details>
          </div>
        )}
      </Section>

      {(pending.length > 0 || (campaign.approvals ?? []).length > 0) && (
        <Section
          title={t("campaigns.approvals.title", { defaultValue: "What needs your approval" })}
          description={t("campaigns.approvals.subtitle", {
            defaultValue: "Each one says exactly what will happen. Nothing spends money or reaches a customer until it is approved.",
          })}
        >
          <ul className="flex flex-col gap-2">
            {(campaign.approvals ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{a.label}</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{a.preview}</p>
                </div>
                {a.state === "pending" ? (
                  <div className="flex shrink-0 gap-1.5">
                    <button onClick={() => decide.mutate({ id: a.id, approve: true })}
                            className="cursor-pointer rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90">
                      {t("campaigns.approvals.approve", { defaultValue: "Approve" })}
                    </button>
                    <button onClick={() => decide.mutate({ id: a.id, approve: false })}
                            className="cursor-pointer rounded-lg border border-border px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">
                      {t("campaigns.approvals.reject", { defaultValue: "Reject" })}
                    </button>
                  </div>
                ) : (
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                                      a.state === "approved" ? "bg-success/12 text-success" : "bg-destructive/12 text-destructive")}>
                    {t(`campaigns.approvals.${a.state}`, { defaultValue: a.state })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {campaign.approval_state === "draft" && (readiness?.requiredApprovals.length ?? 0) > 0 && (
        <button onClick={() => review.mutate()} disabled={review.isPending}
                className="flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-xs font-semibold text-foreground hover:border-foreground/20">
          {review.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {t("campaigns.launch.sendForReview", { defaultValue: "Send for approval" })}
        </button>
      )}

      {tracking && (
        <Section
          title={t("campaigns.tracking.title", { defaultValue: "Tracking" })}
          description={tracking.note}
        >
          <Card className="flex flex-col gap-2 p-4">
            <p className="text-xs text-muted-foreground">
              utm_campaign = <span className="font-mono text-foreground">{tracking.utm_campaign}</span>
            </p>
            {tracking.links.map((l) => (
              <div key={l.channel_id} className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-[11px]">
                <span className="w-24 shrink-0 text-muted-foreground">
                  {t(`campaigns.channel.${l.channel}`, { defaultValue: l.channel })}
                </span>
                <code className="min-w-0 flex-1 truncate font-mono text-foreground">
                  {l.url || `utm_source=${l.utm_source}&utm_medium=${l.utm_medium}&utm_campaign=${l.utm_campaign}&utm_content=${l.utm_content}`}
                </code>
                <button
                  onClick={() => navigator.clipboard.writeText(
                    l.url || `utm_source=${l.utm_source}&utm_medium=${l.utm_medium}&utm_campaign=${l.utm_campaign}&utm_content=${l.utm_content}`)}
                  aria-label={t("common.copy", { defaultValue: "Copy" })}
                  className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground">
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            ))}
          </Card>
        </Section>
      )}
    </div>
  );
}

// ── performance ──────────────────────────────────────────────────────────────

export function PerformanceTab({ campaign }: { campaign: Campaign }) {
  const { t } = useTranslation();
  const { data: perf } = useQuery({
    queryKey: ["campaign-performance", campaign.id],
    queryFn: () => campaignPerformance(campaign.id),
    refetchInterval: campaign.status === "running" ? 60_000 : false,
  });
  const { data: signals = [] } = useQuery({
    queryKey: ["campaign-signals", campaign.id],
    queryFn: () => campaignSignals(campaign.id),
    refetchInterval: campaign.status === "running" ? 120_000 : false,
  });
  const { data: score } = useQuery({
    queryKey: ["campaign-score", campaign.id],
    queryFn: () => campaignScore(campaign.id),
  });

  if (!perf) return <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/30" />;
  const cur = perf.currency;
  // A campaign is work made by a team of agents. Only a project with something
  // to sell is judged on what that work earned; for everyone else the work
  // itself is the outcome, and a revenue row would be a verdict on a race the
  // campaign was never entered in.
  const sells = perf.judged_on_revenue;

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          {sells ? (
            <>
              <Metric label={t("campaigns.kpi.revenue", { defaultValue: "Attributed revenue" })}
                      value={money(perf.lifetime.revenue, cur)}
                      sub={t("campaigns.perf.window", { defaultValue: "{{d}} days", d: perf.window.days })} />
              <Metric label={t("campaigns.kpi.orders", { defaultValue: "Attributed orders" })}
                      value={String(perf.lifetime.orders)} />
              <Metric label={t("campaigns.kpi.aov", { defaultValue: "Average order value" })}
                      value={money(perf.lifetime.aov, cur)} />
              <Metric label={t("campaigns.perf.today", { defaultValue: "Today" })}
                      value={money(perf.today.revenue, cur)}
                      sub={t("campaigns.perf.yesterday", {
                        defaultValue: "yesterday {{v}}", v: money(perf.yesterday.revenue, cur),
                      })} />
            </>
          ) : (
            <>
              <Metric label={t("campaigns.work.pieces", { defaultValue: "Pieces produced" })}
                      value={String(perf.work.pieces)}
                      sub={t("campaigns.work.selected", {
                        defaultValue: "{{n}} chosen", n: perf.work.selected,
                      })} />
              <Metric label={t("campaigns.work.agentSteps", { defaultValue: "Agent steps done" })}
                      value={`${perf.work.agent_steps_done}/${perf.work.agent_steps_total || 0}`} />
              <Metric label={t("campaigns.work.artifacts", { defaultValue: "Deliverables" })}
                      value={String(perf.work.artifacts.length)}
                      sub={perf.work.artifacts.join(", ") || undefined} />
              <Metric label={t("campaigns.perf.window", { defaultValue: "{{d}} days", d: perf.window.days })}
                      value={String(perf.window.days)} tone="muted" />
            </>
          )}
        </div>
        {/* The shape of the period, from the series already in the payload. */}
        {sells && perf.series.length > 2 && (
          <div className="mt-4 flex items-end gap-3 border-t border-border pt-4">
            <Sparkline data={perf.series.map((d) => d.revenue)} width={220} height={40}
                       className="text-primary" />
            <span className="pb-1 text-[11px] text-muted-foreground">
              {t("campaigns.perf.daily", { defaultValue: "attributed revenue per day" })}
            </span>
          </div>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          {sells
            ? t("campaigns.perf.method", {
                defaultValue: "Measured from {{n}} order(s) whose landing URL carried this campaign's tag.",
                n: perf.attribution.matched_orders,
              })
            : t("campaigns.perf.methodWork", {
                defaultValue: "This project is measured by {{what}}, not by orders.",
                what: perf.measured_by,
              })}
        </p>
        {sells && <Unavailable metrics={perf.unavailable} className="mt-4" />}
      </Card>

      {sells && perf.targets.length > 0 && (
        <Section title={t("campaigns.perf.targets", { defaultValue: "Against target" })}>
          <ul className="flex flex-col gap-2">
            {perf.targets.map((tg) => (
              <li key={tg.key} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-foreground">
                    {t(`campaigns.kpi.${tg.key}`, { defaultValue: tg.key })}
                  </span>
                  {tg.measurable ? (
                    <span className="tabular-nums text-muted-foreground">
                      {tg.key === "revenue" ? money(tg.current ?? 0, cur) : tg.current} / {tg.key === "revenue" ? money(tg.target, cur) : tg.target}
                      <span className="ml-2 font-semibold text-foreground">{tg.pct}%</span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {t("campaigns.perf.cannotScore", { defaultValue: "Cannot be scored — needs {{what}}", what: tg.needs })}
                    </span>
                  )}
                </div>
                {tg.measurable && (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary transition-all"
                         style={{ width: `${Math.min(tg.pct ?? 0, 100)}%` }} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {sells && perf.by_source.length > 0 && (
        <Section title={t("campaigns.perf.bySource", { defaultValue: "Where the orders came from" })}>
          <Card className="flex flex-col divide-y divide-border p-0">
            {perf.by_source.map((r) => (
              <div key={r.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                <span className="truncate text-foreground">{r.key}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {money(r.revenue, cur)} · {t("campaigns.ordersCount", { defaultValue: "{{n}} orders", n: r.orders })}
                </span>
              </div>
            ))}
          </Card>
        </Section>
      )}

      {signals.length > 0 && (
        <Section title={t("campaigns.signals.title", { defaultValue: "What to look at" })}>
          <ul className="flex flex-col gap-2">
            {signals.map((s) => (
              <li key={s.key} className={cn(
                "rounded-xl border p-3",
                s.severity === "high" ? "border-destructive/30 bg-destructive/5"
                  : s.severity === "medium" ? "border-warning/30 bg-warning/5"
                  : "border-border",
              )}>
                <p className="text-xs font-semibold text-foreground">{s.title}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{s.detail}</p>
                <p className="mt-1.5 text-[11px] font-medium text-foreground">{s.action}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {score && (
        <Section title={t("campaigns.score.title", { defaultValue: "Campaign score" })}
                 description={t("campaigns.score.subtitle", {
                   defaultValue: "Computed from what is in the campaign, not generated. Every point has a reason.",
                 })}>
          <Card className="p-4">
            <div className="flex flex-wrap items-center gap-4">
              <p className="text-3xl font-semibold tabular-nums text-foreground">
                {score.score}<span className="text-base text-muted-foreground">/100</span>
              </p>
              {/* Each component as a bar, so a weak one is visible without
                  reading seven rows of prose to find it. */}
              <div className="flex min-w-[200px] flex-1 flex-col gap-1">
                {score.parts.filter((p) => p.max > 0).map((p) => (
                  <div key={p.key} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 truncate text-[10px] text-muted-foreground">
                      {t(`campaigns.score.${p.key}`, { defaultValue: p.key })}
                    </span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <span className={cn("block h-full rounded-full",
                                          p.points >= p.max * 0.9 ? "bg-success"
                                            : p.points <= p.max * 0.5 ? "bg-warning" : "bg-primary")}
                            style={{ width: `${Math.round((p.points / p.max) * 100)}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <ul className="mt-3 flex flex-col divide-y divide-border">
              {score.parts.filter((p) => p.max > 0).map((p) => (
                <li key={p.key} className="flex items-start justify-between gap-3 py-2 text-xs">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">
                      {t(`campaigns.score.${p.key}`, { defaultValue: p.key })}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{p.note}</p>
                  </div>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{p.points}/{p.max}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}
    </div>
  );
}

// ── copilot ──────────────────────────────────────────────────────────────────

export function CopilotTab({ campaign }: { campaign: Campaign }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [question, setQuestion] = useState("");

  const ask = useMutation({
    mutationFn: (q: string) => analyseCampaign(campaign.id, q),
    onError: (e: Error) => toast.error(e.message),
  });
  const answer = ask.data;

  const SUGGESTED = [
    t("campaigns.copilot.q1", { defaultValue: "How is this campaign performing?" }),
    t("campaigns.copilot.q2", { defaultValue: "What should I change?" }),
    t("campaigns.copilot.q3", { defaultValue: "Which channel is working best?" }),
  ];

  return (
    <Section
      title={t("campaigns.copilot.title", { defaultValue: "Ask about this campaign" })}
      description={t("campaigns.copilot.subtitle", {
        defaultValue: "Answers come from measured figures only. Anything that needs a connector you do not have is named as such rather than estimated.",
      })}
    >
      <form onSubmit={(e) => { e.preventDefault(); ask.mutate(question.trim()); }}
            className="flex flex-wrap gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("campaigns.copilot.placeholder", { defaultValue: "Why is revenue down this week?" })}
          aria-label={t("campaigns.copilot.title", { defaultValue: "Ask about this campaign" })}
          className="min-w-[220px] flex-1 rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-ring/30"
        />
        <button type="submit" disabled={ask.isPending}
                className="flex cursor-pointer items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
          {ask.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {t("campaigns.copilot.ask", { defaultValue: "Ask" })}
        </button>
      </form>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED.map((q) => (
          <button key={q} onClick={() => { setQuestion(q); ask.mutate(q); }}
                  className="cursor-pointer rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">
            {q}
          </button>
        ))}
      </div>

      {answer && (
        <Card className="flex flex-col gap-3 p-4">
          <p className="text-sm font-semibold leading-relaxed text-foreground">{answer.headline}</p>
          {answer.sample_warning && (
            <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-[11px] leading-relaxed text-foreground">
              {t("campaigns.copilot.smallSample", {
                defaultValue: "Fewer than five attributed orders back this. Treat it as an early read, not a finding.",
              })}
            </p>
          )}
          {answer.what_happened && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("campaigns.copilot.what", { defaultValue: "What happened" })}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{answer.what_happened}</p>
            </div>
          )}
          {answer.why && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("campaigns.copilot.why", { defaultValue: "Why" })}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{answer.why}</p>
            </div>
          )}
          {answer.recommendations?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {t("campaigns.copilot.next", { defaultValue: "What to do" })}
              </p>
              <ul className="mt-1.5 flex flex-col gap-1.5">
                {answer.recommendations.map((r, i) => (
                  <li key={i} className="rounded-lg border border-border p-2.5">
                    <p className="text-xs font-medium text-foreground">{r.action}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{r.why}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {answer.cannot_answer?.length > 0 && (
            <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3">
              <p className="text-[11px] font-semibold text-muted-foreground">
                {t("campaigns.copilot.cannot", { defaultValue: "What it could not answer" })}
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {answer.cannot_answer.slice(0, 6).map((c, i) => (
                  <li key={i} className="text-[11px] leading-relaxed text-muted-foreground">
                    <span className="text-foreground/70">{c.question}</span> — {c.needs}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </Section>
  );
}

// ── the team ─────────────────────────────────────────────────────────────────

/**
 * Who is doing this campaign.
 *
 * This is the answer to the question a person actually has when they delegate
 * work: not "which channels" but "who is on it, and what are they doing". A
 * campaign is a piece of work produced by a combination of agents, so the team
 * is not a footnote on the brief -- it is the brief's first section.
 *
 * The playbook canvas sits underneath when the campaign has agent steps to run.
 * Campaigns created by the strategy engine have a team without steps; ones from
 * the autopilot have steps. Both are the same team doing the same job.
 */
export function TeamTab({ campaign, children }: {
  campaign: Campaign; children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const team = campaign.team ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Section
        title={t("campaigns.team.title", { defaultValue: "Who is on this campaign" })}
        description={t("campaigns.team.subtitle", {
          defaultValue: "Each agent owns part of the work. Assignments come from the plan and stay when it is re-planned.",
        })}
      >
        {!team.length ? (
          <p className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">
            {t("campaigns.team.empty", {
              defaultValue: "Nobody assigned yet. Add a channel or generate a strategy and the work is shared out.",
            })}
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {team.map((m) => {
              const Icon = employeeIcon(m.icon);
              return (
                <Card key={m.id} className="flex flex-col gap-2.5 p-4">
                  <div className="flex items-start gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-4 w-4 text-primary" strokeWidth={2} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{m.name}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{m.role}</p>
                    </div>
                  </div>

                  {m.channels.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {m.channels.map((c) => (
                        <span key={c} className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {t(`campaigns.channel.${c}`, { defaultValue: c })}
                        </span>
                      ))}
                    </div>
                  )}

                  {m.tasks.length > 0 && (
                    <ul className="flex flex-col gap-1 border-t border-border pt-2">
                      {m.tasks.slice(0, 4).map((task, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                          <span className="w-10 shrink-0 tabular-nums">
                            {task.day_offset === 0
                              ? t("campaigns.timeline.launch", { defaultValue: "Launch" })
                              : task.day_offset < 0 ? `D${task.day_offset}` : `D+${task.day_offset}`}
                          </span>
                          <span className="min-w-0 text-foreground/80">{task.title}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <p className="mt-auto text-[11px] text-muted-foreground">
                    {t("campaigns.team.produced", {
                      defaultValue: "{{n}} piece(s) produced", n: m.produced,
                    })}
                  </p>
                </Card>
              );
            })}
          </div>
        )}
      </Section>

      {children}
    </div>
  );
}
