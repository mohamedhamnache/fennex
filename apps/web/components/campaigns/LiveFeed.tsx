"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Campaign } from "@/lib/api";
import { agentVisual } from "@/lib/campaignMeta";
import { cn } from "@/lib/cn";

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function LiveFeed({ campaign, onCancel, cancelling }: { campaign: Campaign; onCancel: () => void; cancelling: boolean }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const started = campaign.steps
    .map((s) => s.started_at)
    .filter(Boolean)
    .sort()[0];
  const elapsed = started ? fmtElapsed(now - new Date(started as string).getTime()) : "--:--";
  const done = campaign.steps.filter((s) => s.status === "completed").length;
  const total = campaign.steps.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const feed = campaign.steps.filter((s) => s.status === "completed" && s.summary).slice(-3);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card/80 p-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="relative h-10 w-10 shrink-0" role="img" aria-label={`${pct}%`}>
          <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--border))" strokeWidth="3.5" />
            <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--primary))" strokeWidth="3.5"
              strokeDasharray={`${(pct / 100) * 94.2} 94.2`} strokeLinecap="round" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold tabular-nums text-foreground">{pct}%</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">{t("campaigns.canvas.stepsDone", { done, total })}</p>
          <p className="text-[11px] tabular-nums text-muted-foreground">{t("campaigns.canvas.elapsed")} {elapsed}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {t("campaigns.cancel")}
        </button>
      </div>
      {feed.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("campaigns.canvas.liveFeed")}</p>
          {feed.map((s) => {
            const v = agentVisual(s.agent);
            return (
              <p key={s.id} className="truncate text-[11px] text-foreground/90 animate-msg-in">
                <span className={cn("bg-gradient-to-r bg-clip-text font-bold text-transparent", v.gradient)}>{v.name}</span>
                <span className="text-muted-foreground"> — {s.summary}</span>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
