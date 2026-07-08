"use client";

import { useTranslation } from "react-i18next";
import { X, Trash2 } from "lucide-react";
import type { Campaign, CampaignStep } from "@/lib/api";
import { agentVisual, estimateFor, fmtEstimate, actionLabelKey } from "@/lib/campaignMeta";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

interface StepPanelProps {
  step: CampaignStep;
  campaign: Campaign;
  onClose: () => void;
  onRemove: (stepId: string) => void;
  removing: boolean;
}

export function StepPanel({ step, campaign, onClose, onRemove, removing }: StepPanelProps) {
  const { t } = useTranslation();
  const visual = agentVisual(step.agent);
  const brief = step.brief ?? {};
  const briefEntries = Object.entries(brief).filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <Card className="flex h-full flex-col gap-3 p-4 animate-slide-up">
      <div className="flex items-start gap-2.5">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white", visual.gradient)}>
          <visual.Icon className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{visual.name}</p>
          <p className="text-xs text-muted-foreground">{t(actionLabelKey(step.action))}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {step.why && <p className="text-xs italic leading-relaxed text-muted-foreground">&ldquo;{step.why}&rdquo;</p>}

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("campaigns.stepPanel.brief")}</p>
        {briefEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("campaigns.stepPanel.noBrief")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {briefEntries.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
                <span className="text-[10px] font-medium text-muted-foreground">{k}</span>
                <p className="truncate text-xs text-foreground">{String(v)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {t("campaigns.stepPanel.estimateLabel")}: {fmtEstimate(estimateFor(step.action), t("campaigns.canvas.minutes"))}
      </p>

      {step.summary && <p className="rounded-lg bg-muted/40 p-2.5 text-xs leading-relaxed text-foreground/90">{step.summary}</p>}
      {step.error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          {t("campaigns.stepPanel.errorLabel")}: {step.error}
        </p>
      )}

      {campaign.status === "planned" && (
        <button
          type="button"
          onClick={() => onRemove(step.id)}
          disabled={removing}
          className="mt-auto flex items-center justify-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> {t("campaigns.stepPanel.removeStep")}
        </button>
      )}
    </Card>
  );
}
