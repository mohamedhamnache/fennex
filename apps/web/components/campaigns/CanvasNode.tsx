"use client";

import { useTranslation } from "react-i18next";
import { Check, X, Target, Gift, SkipForward } from "lucide-react";
import type { CampaignStep } from "@/lib/api";
import { agentVisual, estimateFor, fmtEstimate, actionLabelKey } from "@/lib/campaignMeta";
import { NODE_W, NODE_H } from "./canvasLayout";
import { cn } from "@/lib/cn";

interface CanvasNodeProps {
  kind: "goal" | "step" | "package";
  x: number;
  y: number;
  step?: CampaignStep;
  goal?: string;
  packageInfo?: { done: number; total: number };
  mode: "plan" | "run" | "package";
  active?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

export function CanvasNode({ kind, x, y, step, goal, packageInfo, mode, active, selected, onClick }: CanvasNodeProps) {
  const { t } = useTranslation();
  const base = "absolute rounded-2xl border text-left transition-all";
  const pos = { left: x, top: y, width: NODE_W, height: NODE_H } as const;

  if (kind === "goal") {
    return (
      <div style={pos} className={cn(base, "flex flex-col justify-center gap-1 border-primary/40 bg-foreground p-3 text-background dark:bg-card dark:text-foreground dark:border-primary/50")}>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">
          <Target className="h-3 w-3" /> {t("campaigns.canvas.goal")}
        </span>
        <span className="line-clamp-2 text-xs font-semibold leading-snug">{goal}</span>
      </div>
    );
  }

  if (kind === "package") {
    return (
      <div style={pos} className={cn(base, "flex flex-col items-center justify-center gap-1 border-dashed border-border bg-card/60 p-3", mode === "package" && "border-solid border-success/60 bg-success/5")}>
        <Gift className={cn("h-4 w-4", mode === "package" ? "text-success" : "text-muted-foreground")} strokeWidth={1.8} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("campaigns.canvas.package")}</span>
        {packageInfo && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {t("campaigns.canvas.packagePending", { done: packageInfo.done, total: packageInfo.total })}
          </span>
        )}
      </div>
    );
  }

  const s = step!;
  const visual = agentVisual(s.agent);
  const stateClass =
    s.status === "completed" ? "border-success/70" :
    s.status === "failed" ? "border-destructive/70" :
    s.status === "skipped" ? "border-border border-dashed opacity-60" :
    active ? "border-primary node-active shadow-lg" :
    "border-border border-dashed";

  return (
    <button
      type="button"
      onClick={onClick}
      style={pos}
      className={cn(base, "bg-card p-2.5 hover:border-primary/50", stateClass, selected && "ring-2 ring-primary/40")}
    >
      <span className="flex items-center gap-2">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white", visual.gradient)}>
          <visual.Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-bold text-foreground">{visual.name}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{t(actionLabelKey(s.action))}</span>
        </span>
        {s.status === "completed" && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-success" strokeWidth={3} />}
        {s.status === "failed" && <X className="ml-auto h-3.5 w-3.5 shrink-0 text-destructive" strokeWidth={3} />}
        {s.status === "skipped" && <SkipForward className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </span>
      <span className="mt-1.5 block truncate text-[10px] text-muted-foreground">
        {mode === "plan"
          ? fmtEstimate(estimateFor(s.action), t("campaigns.canvas.minutes"))
          : t(`campaigns.stepStatus.${s.status}`)}
      </span>
    </button>
  );
}
