"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { X, Send, Trash2 } from "lucide-react";
import {
  updateCalendarEntry,
  deleteCalendarEntry,
  publishCalendarEntryNow,
  listPublishingConnections,
  type CalendarEntry,
  type CalendarState,
} from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

interface CalendarEntryPopoverProps {
  projectId: string;
  entry: CalendarEntry;
  onClose: () => void;
}

const STATE_COLOR: Record<CalendarState, string> = {
  failed: "bg-destructive/15 text-destructive",
  published: "bg-success/15 text-success",
  scheduled: "bg-primary/15 text-primary",
  planned: "bg-muted text-muted-foreground",
  publishing: "bg-muted text-muted-foreground",
};

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CalendarEntryPopover({ projectId, entry, onClose }: CalendarEntryPopoverProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [scheduledAt, setScheduledAt] = useState(() => toLocalInputValue(entry.scheduled_at));
  const [targetKind, setTargetKind] = useState<"wordpress" | "linkedin">(entry.target_kind ?? (entry.content_type === "social" ? "linkedin" : "wordpress"));
  const [connectionId, setConnectionId] = useState(entry.connection_id ?? "");
  const [busy, setBusy] = useState(false);

  const { data: connections = [] } = useQuery({
    queryKey: ["calendar-connections", projectId],
    queryFn: () => listPublishingConnections(projectId),
    enabled: targetKind === "wordpress",
  });
  const wordpressConnections = useMemo(
    () => connections.filter((c) => c.platform === "wordpress"),
    [connections],
  );

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["calendar", projectId] });
  }

  async function handleReschedule(value: string) {
    setScheduledAt(value);
    if (!value) return;
    setBusy(true);
    try {
      await updateCalendarEntry(entry.id, { scheduled_at: new Date(value).toISOString() });
      await invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleTargetChange(kind: "wordpress" | "linkedin", connId: string) {
    setTargetKind(kind);
    setConnectionId(connId);
    setBusy(true);
    try {
      await updateCalendarEntry(entry.id, {
        target_kind: kind,
        connection_id: kind === "wordpress" ? connId || undefined : undefined,
      });
      await invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleState() {
    const nextState: CalendarState =
      entry.state === "planned" ? "scheduled" : entry.state === "failed" ? "scheduled" : "planned";
    setBusy(true);
    try {
      await updateCalendarEntry(entry.id, { state: nextState });
      await invalidate();
    } catch {
      toast.error(t("calendar.needTarget"));
    } finally {
      setBusy(false);
    }
  }

  async function handlePublishNow() {
    setBusy(true);
    try {
      await publishCalendarEntryNow(entry.id);
      await invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteCalendarEntry(entry.id);
      await invalidate();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const labelClass = "mb-1.5 block text-xs font-medium text-foreground";
  const inputClass =
    "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:ring-0 transition-colors";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="popover relative flex w-full max-w-md flex-col animate-scale-in max-h-[90vh]">
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{entry.title}</p>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t(`calendar.type.${entry.content_type}`)}
              </span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATE_COLOR[entry.state])}>
                {t(`calendar.state.${entry.state}`)}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={t("calendar.cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 p-4">
          {entry.error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{entry.error}</p>
          )}

          <div>
            <label className={labelClass}>{t("calendar.reschedule")}</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => handleReschedule(e.target.value)}
              disabled={busy}
              className={inputClass}
            />
          </div>

          <div>
            <label className={labelClass}>{t("calendar.target")}</label>
            <select
              value={targetKind}
              onChange={(e) => handleTargetChange(e.target.value as "wordpress" | "linkedin", connectionId)}
              disabled={busy}
              className={inputClass}
            >
              <option value="wordpress">{t("calendar.targetWordpress")}</option>
              <option value="linkedin">{t("calendar.targetLinkedin")}</option>
            </select>
            {targetKind === "wordpress" && (
              <select
                value={connectionId}
                onChange={(e) => handleTargetChange("wordpress", e.target.value)}
                disabled={busy}
                className={cn(inputClass, "mt-2")}
              >
                <option value="">{t("calendar.targetWordpress")}</option>
                {wordpressConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <span className="text-xs font-medium text-foreground">{t(`calendar.state.${entry.state === "planned" ? "planned" : "scheduled"}`)}</span>
            <button
              type="button"
              onClick={handleToggleState}
              disabled={busy || entry.state === "publishing" || entry.state === "published"}
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50",
                entry.state === "planned" ? "bg-muted" : "bg-primary",
              )}
              aria-label={t("calendar.reschedule")}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform",
                  entry.state === "planned" ? "left-0.5" : "left-[18px]",
                )}
              />
            </button>
          </div>
        </div>

        <div className="flex gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t("calendar.delete")}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={handlePublishNow}
            disabled={busy}
            className="btn-primary flex items-center gap-1.5 px-3 py-2 text-xs disabled:opacity-50"
          >
            <Send className="h-3.5 w-3.5" />
            {t("calendar.publishNow")}
          </button>
        </div>
      </div>
    </div>
  );
}
