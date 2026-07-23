"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ChevronLeft, ChevronRight, CalendarDays, Plus, FileText, Share2,
  Image as ImageIcon, LayoutGrid, List, Clock, CalendarClock, CheckCircle2,
  CircleDashed, GripVertical, type LucideIcon,
} from "lucide-react";
import {
  listCalendar, updateCalendarEntry,
  type CalendarEntry, type CalendarContentType, type CalendarState,
} from "@/lib/api";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { AddToCalendarModal } from "@/components/calendar/AddToCalendarModal";
import { CalendarEntryPopover } from "@/components/calendar/CalendarEntryPopover";

// ── Type + state visual metadata ──────────────────────────────────────────────
const TYPE_META: Record<CalendarContentType, { Icon: LucideIcon; chip: string; solid: string }> = {
  article: { Icon: FileText, chip: "border-primary/25 bg-primary/12 text-primary", solid: "bg-primary" },
  social: { Icon: Share2, chip: "border-sky-500/25 bg-sky-500/12 text-sky-500", solid: "bg-sky-500" },
  banner: { Icon: ImageIcon, chip: "border-violet-500/25 bg-violet-500/12 text-violet-500", solid: "bg-violet-500" },
};

const STATE_DOT: Record<CalendarState, string> = {
  planned: "bg-muted-foreground/60",
  scheduled: "bg-primary",
  publishing: "bg-warning",
  published: "bg-success",
  failed: "bg-destructive",
};

const TYPES: CalendarContentType[] = ["article", "social", "banner"];

// ── Date helpers ───────────────────────────────────────────────────────────────
function monthMatrix(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7; // Monday-first
  const start = new Date(year, month, 1 - startDow);
  const weeks: Date[][] = [];
  for (let w = 0; w < 6; w++) {
    const row: Date[] = [];
    for (let d = 0; d < 7; d++) {
      row.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + d));
    }
    weeks.push(row);
  }
  return weeks;
}
function ymd(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function localDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** Default schedule time for a day: 9:00, but never in the past (→ ~now for today). */
function dayDefaultDateTime(d: Date): string {
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0);
  const now = new Date();
  return localDateTime(base.getTime() < now.getTime() ? new Date(now.getTime() + 5 * 60_000) : base);
}
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

export default function CalendarPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [view, setView] = useState<"month" | "agenda">("month");
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [typeFilter, setTypeFilter] = useState<"all" | CalendarContentType>("all");
  const [modalDefaultDate, setModalDefaultDate] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [activeEntry, setActiveEntry] = useState<CalendarEntry | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const weeks = useMemo(() => monthMatrix(year, month), [year, month]);
  const rangeStart = new Date(year, month, 1 - ((new Date(year, month, 1).getDay() + 6) % 7)).toISOString();
  const rangeEnd = new Date(year, month + 1, 7).toISOString();

  const { data: entries = [] } = useQuery({
    queryKey: ["calendar", projectId, year, month],
    queryFn: () => listCalendar(projectId, rangeStart, rangeEnd),
    staleTime: 60_000,
  });

  const filtered = useMemo(
    () => (typeFilter === "all" ? entries : entries.filter((e) => e.content_type === typeFilter)),
    [entries, typeFilter],
  );

  const byDay = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    for (const e of filtered) {
      const key = ymd(new Date(e.scheduled_at));
      (map[key] ||= []).push(e);
    }
    for (const k in map) map[k].sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at));
    return map;
  }, [filtered]);

  // Stats scoped to the visible month.
  const stats = useMemo(() => {
    const inMonth = filtered.filter((e) => { const d = new Date(e.scheduled_at); return d.getFullYear() === year && d.getMonth() === month; });
    const by = (s: CalendarState) => inMonth.filter((e) => e.state === s).length;
    return { total: inMonth.length, scheduled: by("scheduled"), published: by("published"), planned: by("planned") };
  }, [filtered, year, month]);

  // Agenda: everything from the start of today, chronological.
  const upcoming = useMemo(() => {
    const from = startOfDay(new Date()).getTime();
    return filtered
      .filter((e) => new Date(e.scheduled_at).getTime() >= from)
      .sort((a, b) => +new Date(a.scheduled_at) - +new Date(b.scheduled_at));
  }, [filtered]);

  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(i18n.language, { weekday: "short" })),
    [i18n.language],
  );

  const monthLabel = cursor.toLocaleDateString(i18n.language, { month: "long", year: "numeric" });
  const todayKey = ymd(new Date());

  function timeLabel(iso: string) { return new Date(iso).toLocaleTimeString(i18n.language, { hour: "numeric", minute: "2-digit" }); }

  function dayGroupLabel(d: Date) {
    const diff = Math.round((startOfDay(d).getTime() - startOfDay(new Date()).getTime()) / 86_400_000);
    if (diff === 0) return t("calendar.today");
    if (diff === 1) return t("calendar.tomorrow");
    return d.toLocaleDateString(i18n.language, { weekday: "long", month: "short", day: "numeric" });
  }

  async function rescheduleTo(entry: CalendarEntry, day: Date) {
    const old = new Date(entry.scheduled_at);
    if (ymd(old) === ymd(day)) return;
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes());
    // Keep the original time of day, but never land in the past (e.g. dragging
    // to today when the entry's time has already passed).
    const ms = Math.max(next.getTime(), Date.now() + 5 * 60_000);
    try {
      await updateCalendarEntry(entry.id, { scheduled_at: new Date(ms).toISOString() });
      await queryClient.invalidateQueries({ queryKey: ["calendar", projectId] });
      toast.success(t("calendar.rescheduled"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function openAdd(d: Date) { setModalDefaultDate(dayDefaultDateTime(d)); setShowModal(true); }

  // ── Entry chip (shared by month + agenda) ──
  function EntryChip({ entry, compact }: { entry: CalendarEntry; compact?: boolean }) {
    const meta = TYPE_META[entry.content_type];
    return (
      <div
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragId(entry.id); }}
        onDragEnd={() => { setDragId(null); setDragOverKey(null); }}
        onClick={(ev) => { ev.stopPropagation(); setActiveEntry(entry); }}
        title={entry.title}
        className={cn(
          "group/chip flex cursor-pointer items-center gap-1.5 rounded-md border px-1.5 py-1 text-[11px] font-medium transition-all hover:brightness-105 active:scale-[0.98]",
          meta.chip,
          dragId === entry.id && "opacity-40",
        )}
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATE_DOT[entry.state])} />
        {!compact && <span className="shrink-0 tabular-nums opacity-70">{timeLabel(entry.scheduled_at)}</span>}
        <span className="truncate">{entry.title}</span>
        <GripVertical className="ml-auto h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/chip:opacity-40" />
      </div>
    );
  }

  const statTiles = [
    { icon: CalendarDays, label: t("calendar.thisMonth"), value: stats.total, tone: "bg-primary/12 text-primary" },
    { icon: CalendarClock, label: t("calendar.state.scheduled"), value: stats.scheduled, tone: "bg-primary/12 text-primary" },
    { icon: CheckCircle2, label: t("calendar.state.published"), value: stats.published, tone: "bg-emerald-500/15 text-emerald-500" },
    { icon: CircleDashed, label: t("calendar.state.planned"), value: stats.planned, tone: "bg-muted text-muted-foreground" },
  ];

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card/50 px-5 py-4">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(600px 160px at 8% -40%, hsl(var(--primary) / 0.14), transparent 60%)" }}
        />
        <div className="relative flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl gradient-brand glow-primary">
            <CalendarDays className="h-5 w-5 text-white" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-xl font-bold tracking-tight text-foreground">{t("calendar.title")}</h1>
            <p className="text-xs text-muted-foreground">{t("calendar.subtitle")}</p>
          </div>

          {/* View switcher */}
          <div className="flex items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
            {([["month", LayoutGrid], ["agenda", List]] as const).map(([v, Icon]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                  view === v ? "bg-card text-primary shadow-sm ring-1 ring-inset ring-primary/15" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {t(`calendar.view.${v}`)}
              </button>
            ))}
          </div>

          <button onClick={() => openAdd(new Date())} className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-xs">
            <Plus className="h-3.5 w-3.5" /> {t("calendar.addContent")}
          </button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statTiles.map((s) => (
          <div key={s.label} className="glass glass-hover flex items-center gap-3 p-3.5">
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", s.tone)}>
              <s.icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{s.label}</p>
              <p className="font-display text-xl font-bold tabular-nums leading-tight">{s.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Toolbar: month nav + type filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label={t("calendar.prev")}><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[10rem] text-center font-display text-sm font-bold capitalize text-foreground">{monthLabel}</span>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="rounded-lg border border-border p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label={t("calendar.next")}><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }} className="ml-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent">{t("calendar.today")}</button>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1 rounded-xl border border-border bg-muted/40 p-1">
          <button
            onClick={() => setTypeFilter("all")}
            className={cn("rounded-lg px-2.5 py-1 text-xs font-medium transition-all", typeFilter === "all" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          >
            {t("calendar.allTypes")}
          </button>
          {TYPES.map((tp) => {
            const meta = TYPE_META[tp];
            const active = typeFilter === tp;
            return (
              <button
                key={tp}
                onClick={() => setTypeFilter(tp)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                  active ? "bg-card shadow-sm ring-1 ring-inset ring-border" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <meta.Icon className={cn("h-3.5 w-3.5", active && "text-primary")} />
                <span className={active ? "text-foreground" : undefined}>{t(`calendar.type.${tp}`)}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── MONTH VIEW ── */}
      {view === "month" && (
        <>
          <div className="overflow-hidden rounded-2xl border border-border bg-card/40">
            <div className="grid grid-cols-7 border-b border-border bg-muted/25 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {weekdays.map((d, i) => (
                <div key={i} className={cn("px-2 py-2.5 text-center", (i === 5 || i === 6) && "text-muted-foreground/60")}>{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {weeks.flat().map((day, i) => {
                const key = ymd(day);
                const items = byDay[key] ?? [];
                const dim = day.getMonth() !== month;
                const isToday = key === todayKey;
                const past = startOfDay(day).getTime() < startOfDay(new Date()).getTime();
                const weekend = day.getDay() === 0 || day.getDay() === 6;
                const isDropTarget = dragOverKey === key && dragId !== null && !past;
                return (
                  <div
                    key={i}
                    onClick={() => { if (!past) openAdd(day); }}
                    onDragOver={(e) => { if (dragId && !past) { e.preventDefault(); setDragOverKey(key); } }}
                    onDragLeave={() => setDragOverKey((k) => (k === key ? null : k))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const entry = entries.find((x) => x.id === dragId);
                      if (entry && !past) rescheduleTo(entry, day);
                      setDragId(null); setDragOverKey(null);
                    }}
                    className={cn(
                      "group relative min-h-[116px] border-b border-r border-border p-1.5 transition-colors",
                      past ? "cursor-default" : "cursor-pointer",
                      weekend && !dim && !past && "bg-muted/[0.15]",
                      dim && "bg-muted/25",
                      past && !dim && "bg-muted/[0.12]",
                      isDropTarget ? "bg-primary/[0.08] ring-2 ring-inset ring-primary/40" : !past && "hover:bg-accent/40",
                    )}
                  >
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={cn(
                          "flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                          isToday ? "gradient-brand text-white shadow-sm" : dim ? "text-muted-foreground/50" : "text-muted-foreground",
                        )}
                      >
                        {day.getDate()}
                      </span>
                      {!past && (
                        <button
                          onClick={(e) => { e.stopPropagation(); openAdd(day); }}
                          className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-primary/15 hover:text-primary group-hover:opacity-100"
                          aria-label={t("calendar.addContent")}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-col gap-1">
                      {items.slice(0, 3).map((e) => <EntryChip key={e.id} entry={e} />)}
                      {items.length > 3 && (
                        <span className="px-1 text-[10px] font-medium text-muted-foreground">+{items.length - 3}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground/70">
            <GripVertical className="h-3 w-3" /> {t("calendar.dragHint")}
          </p>
        </>
      )}

      {/* ── AGENDA VIEW ── */}
      {view === "agenda" && (
        <div className="rounded-2xl border border-border bg-card/40 p-4">
          {upcoming.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <CalendarClock className="h-6 w-6" strokeWidth={1.8} />
              </span>
              <p className="text-sm text-muted-foreground">{t("calendar.noUpcoming")}</p>
              <button onClick={() => openAdd(new Date())} className="btn-primary flex items-center gap-1.5 px-3.5 py-2 text-xs">
                <Plus className="h-3.5 w-3.5" /> {t("calendar.addContent")}
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {Object.entries(
                upcoming.reduce<Record<string, CalendarEntry[]>>((acc, e) => {
                  const k = ymd(new Date(e.scheduled_at));
                  (acc[k] ||= []).push(e);
                  return acc;
                }, {}),
              ).map(([key, items]) => {
                const day = new Date(items[0].scheduled_at);
                const isToday = key === todayKey;
                return (
                  <div key={key} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <span className={cn("font-display text-sm font-bold", isToday ? "text-primary" : "text-foreground")}>{dayGroupLabel(day)}</span>
                      <span className="text-xs text-muted-foreground">{t("calendar.scheduledCount", { count: items.length })}</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    {items.map((e) => {
                      const meta = TYPE_META[e.content_type];
                      return (
                        <button
                          key={e.id}
                          onClick={() => setActiveEntry(e)}
                          className="group flex items-center gap-3 rounded-xl border border-border bg-card/50 px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
                        >
                          <span className="inline-flex w-16 shrink-0 items-center gap-1 text-xs font-medium tabular-nums text-muted-foreground">
                            <Clock className="h-3 w-3" /> {timeLabel(e.scheduled_at)}
                          </span>
                          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border", meta.chip)}>
                            <meta.Icon className="h-4 w-4" strokeWidth={1.9} />
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">{e.title}</span>
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            <span className={cn("h-1.5 w-1.5 rounded-full", STATE_DOT[e.state])} />
                            {t(`calendar.state.${e.state}`)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showModal && (
        <AddToCalendarModal
          projectId={projectId}
          defaultDate={modalDefaultDate ?? undefined}
          onClose={() => { setShowModal(false); setModalDefaultDate(null); }}
        />
      )}

      {activeEntry && (
        <CalendarEntryPopover
          projectId={projectId}
          entry={activeEntry}
          onClose={() => setActiveEntry(null)}
        />
      )}
    </div>
  );
}
