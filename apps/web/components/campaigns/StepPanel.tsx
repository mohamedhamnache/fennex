"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  X, Trash2, FileText, Image as ImageIcon, Share2, BarChart3, Users, Radar,
  ExternalLink, Loader2, Check, AlertCircle, Clock,
} from "lucide-react";
import type { Campaign, CampaignStep } from "@/lib/api";
import { agentVisual, estimateFor, fmtEstimate, actionLabelKey } from "@/lib/campaignMeta";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

interface StepPanelProps {
  step: CampaignStep;
  campaign: Campaign;
  projectId: string;
  onClose: () => void;
  onRemove: (stepId: string) => void;
  removing: boolean;
}

const STEP_STATUS: Record<string, { icon: typeof Check; cls: string; key: string }> = {
  pending: { icon: Clock, cls: "text-muted-foreground bg-muted", key: "pending" },
  running: { icon: Loader2, cls: "text-primary bg-primary/10", key: "running" },
  completed: { icon: Check, cls: "text-success bg-success/10", key: "completed" },
  failed: { icon: AlertCircle, cls: "text-destructive bg-destructive/10", key: "failed" },
  skipped: { icon: X, cls: "text-muted-foreground bg-muted", key: "skipped" },
};

/** Renders what a completed step actually produced, with a way to open it. */
function StepOutput({ step, projectId }: { step: CampaignStep; projectId: string }) {
  const { t } = useTranslation();
  const st = (step.structured ?? {}) as Record<string, unknown>;
  const ids = step.artifact_ids ?? [];

  const OutputLink = ({ Icon, title, href, label }: { Icon: typeof FileText; title: string; href: string; label: string }) => (
    <Link href={href} className="group flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 p-2.5 transition-colors hover:border-primary/40 hover:bg-primary/5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background text-primary"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-foreground">{title}</span>
        <span className="flex items-center gap-1 text-[11px] text-primary">{label} <ExternalLink className="h-3 w-3" /></span>
      </span>
    </Link>
  );

  switch (step.artifact_type) {
    case "article":
      return <OutputLink Icon={FileText} title={String(st.title ?? t("campaigns.stepPanel.article"))} href={`/${projectId}/articles`} label={t("campaigns.stepPanel.openArticle")} />;
    case "image":
      return <OutputLink Icon={ImageIcon} title={t("campaigns.stepPanel.visual")} href={st.image_id ? `/${projectId}/images/edit/${st.image_id}` : `/${projectId}/images`} label={t("campaigns.stepPanel.viewImage")} />;
    case "social": {
      const platforms = Array.isArray(st.platforms) ? (st.platforms as string[]).join(", ") : "";
      const title = t("campaigns.stepPanel.drafts", { count: ids.length || (st.drafts_saved as number) || 0 }) + (platforms ? ` · ${platforms}` : "");
      return <OutputLink Icon={Share2} title={title} href={`/${projectId}/social`} label={t("campaigns.stepPanel.openSocial")} />;
    }
    case "report":
      return typeof st.markdown === "string" ? (
        <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/30 p-2.5 text-[11px] leading-relaxed text-foreground/90">{st.markdown}</div>
      ) : null;
    case "research": {
      const segments = Array.isArray(st.segments) ? (st.segments as Array<Record<string, unknown>>) : [];
      return segments.length ? (
        <div className="flex flex-col gap-1.5">
          {segments.map((s, i) => (
            <div key={i} className="rounded-lg border border-border bg-muted/30 p-2.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><Users className="h-3 w-3 text-primary" /> {String(s.name ?? "")}</p>
              {s.description ? <p className="mt-0.5 text-[11px] text-muted-foreground">{String(s.description)}</p> : null}
            </div>
          ))}
        </div>
      ) : null;
    }
    case "analysis": {
      const a = (st.analysis ?? {}) as Record<string, unknown>;
      const sc = (a.scorecard ?? {}) as Record<string, unknown>;
      return (
        <div className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs text-foreground/90">
          <p className="flex items-center gap-1.5 font-semibold"><Radar className="h-3 w-3 text-primary" /> {String(a.url ?? t("campaigns.stepPanel.analysis"))}</p>
          {sc.score != null ? <p className="mt-1 text-[11px] text-muted-foreground">Score: {String(sc.score)}/100</p> : null}
          {typeof a.insights === "string" && a.insights ? <p className="mt-1 line-clamp-4 text-[11px] text-muted-foreground">{a.insights}</p> : null}
        </div>
      );
    }
    default:
      return null;
  }
}

export function StepPanel({ step, campaign, projectId, onClose, onRemove, removing }: StepPanelProps) {
  const { t } = useTranslation();
  const visual = agentVisual(step.agent);
  const brief = step.brief ?? {};
  const briefEntries = Object.entries(brief).filter(([, v]) => v !== null && v !== undefined && v !== "");
  const status = STEP_STATUS[step.status] ?? STEP_STATUS.pending;
  const StatusIcon = status.icon;

  return (
    <Card className="flex h-full flex-col gap-3 overflow-y-auto p-4 animate-slide-up">
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

      {/* Status */}
      <span className={cn("inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", status.cls)}>
        <StatusIcon className={cn("h-3 w-3", step.status === "running" && "animate-spin")} />
        {t(`campaigns.stepPanel.status.${status.key}`)}
      </span>

      {step.why && <p className="text-xs italic leading-relaxed text-muted-foreground">&ldquo;{step.why}&rdquo;</p>}

      {/* Output — what this step produced */}
      {step.status === "completed" && (step.artifact_type || step.summary) && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("campaigns.stepPanel.output")}</p>
          {step.summary && <p className="mb-2 rounded-lg bg-muted/40 p-2.5 text-xs leading-relaxed text-foreground/90">{step.summary}</p>}
          <StepOutput step={step} projectId={projectId} />
        </div>
      )}

      {step.error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          {t("campaigns.stepPanel.errorLabel")}: {step.error}
        </p>
      )}

      {/* Brief */}
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

      {step.status === "pending" && (
        <p className="text-[11px] text-muted-foreground">
          {t("campaigns.stepPanel.estimateLabel")}: {fmtEstimate(estimateFor(step.action), t("campaigns.canvas.minutes"))}
        </p>
      )}

      {campaign.status === "planned" && (
        <button
          type="button"
          onClick={() => onRemove(step.id)}
          disabled={removing || campaign.steps.length <= 1}
          className="mt-auto flex items-center justify-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> {t("campaigns.stepPanel.removeStep")}
        </button>
      )}
    </Card>
  );
}
