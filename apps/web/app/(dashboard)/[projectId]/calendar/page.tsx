"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, CalendarDays, Plus } from "lucide-react";
import { listCalendar, type CalendarEntry } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { AddToCalendarModal } from "@/components/calendar/AddToCalendarModal";
import { CalendarEntryPopover } from "@/components/calendar/CalendarEntryPopover";

const TYPE_COLOR: Record<string, string> = {
  article: "bg-primary/15 text-primary",
  social: "bg-violet-500/15 text-violet-500",
  banner: "bg-amber-500/15 text-amber-600",
};

const STATE_DOT: Record<string, string> = {
  planned: "bg-muted-foreground",
  scheduled: "bg-primary",
  publishing: "bg-warning",
  published: "bg-success",
  failed: "bg-destructive",
};

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

function dayDefaultDateTime(d: Date): string {
  return `${ymd(d)}T09:00`;
}

export default function CalendarPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  const [modalDefaultDate, setModalDefaultDate] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [activeEntry, setActiveEntry] = useState<CalendarEntry | null>(null);

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

  const byDay = useMemo(() => {
    const map: Record<string, CalendarEntry[]> = {};
    for (const e of entries) {
      const key = ymd(new Date(e.scheduled_at));
      (map[key] ||= []).push(e);
    }
    return map;
  }, [entries]);

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const todayKey = ymd(new Date());

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <CalendarDays className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-foreground leading-tight">{t("calendar.title")}</h1>
          <p className="text-xs text-muted-foreground leading-tight">{t("calendar.subtitle")}</p>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="rounded-lg border border-border p-1.5 hover:bg-accent" aria-label={t("calendar.prev")}><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[9rem] text-center text-sm font-semibold text-foreground">{monthLabel}</span>
          <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="rounded-lg border border-border p-1.5 hover:bg-accent" aria-label={t("calendar.next")}><ChevronRight className="h-4 w-4" /></button>
          <button onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }} className="ml-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent">{t("calendar.today")}</button>
        </div>
        <button
          onClick={() => { setModalDefaultDate(dayDefaultDateTime(new Date())); setShowModal(true); }}
          className="btn-primary flex items-center gap-1.5 px-3 py-2 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("calendar.addContent")}
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b bg-muted/30 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="px-2 py-2 text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {weeks.flat().map((day, i) => {
            const key = ymd(day);
            const items = byDay[key] ?? [];
            const dim = day.getMonth() !== month;
            return (
              <div
                key={i}
                onClick={() => { setModalDefaultDate(dayDefaultDateTime(day)); setShowModal(true); }}
                className={cn("min-h-[92px] cursor-pointer border-b border-r p-1.5 transition-colors hover:bg-accent/40", dim && "bg-muted/20")}
              >
                <div className={cn("mb-1 text-[11px] font-medium", key === todayKey ? "text-primary" : "text-muted-foreground")}>
                  {day.getDate()}
                </div>
                <div className="flex flex-col gap-1">
                  {items.slice(0, 3).map((e) => (
                    <div
                      key={e.id}
                      onClick={(ev) => { ev.stopPropagation(); setActiveEntry(e); }}
                      className={cn("flex items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium", TYPE_COLOR[e.content_type])}
                      title={e.title}
                    >
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATE_DOT[e.state])} />
                      <span className="truncate">{e.title}</span>
                    </div>
                  ))}
                  {items.length > 3 && <span className="px-1 text-[10px] text-muted-foreground">+{items.length - 3}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
      {entries.length === 0 && <p className="text-center text-xs text-muted-foreground">{t("calendar.empty")}</p>}

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
