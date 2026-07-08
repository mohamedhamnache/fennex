"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Megaphone, Loader2, X, Play, Ban, ArrowLeft, Plus, ChevronRight,
  CheckCircle2, XCircle, CircleDashed, CircleSlash,
} from "lucide-react";
import {
  createCampaign, listCampaigns, getCampaign, updateCampaignPlan,
  runCampaign, cancelCampaign, type Campaign, type CampaignStepStatus,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

const STEP_STATUS_ICON: Record<CampaignStepStatus, typeof CircleDashed> = {
  pending: CircleDashed,
  running: Loader2,
  completed: CheckCircle2,
  failed: XCircle,
  skipped: CircleSlash,
};

const STEP_STATUS_COLOR: Record<CampaignStepStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-primary",
  completed: "text-success",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
};

const CAMPAIGN_STATUS_BADGE: Record<Campaign["status"], string> = {
  planned: "bg-muted text-muted-foreground",
  running: "bg-primary/12 text-primary",
  completed: "bg-success/12 text-success",
  failed: "bg-destructive/12 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

export default function CampaignsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [goal, setGoal] = useState("");
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);

  const { data: campaigns = [] } = useQuery({
    queryKey: ["campaigns", projectId],
    queryFn: () => listCampaigns(projectId),
    staleTime: 15_000,
  });

  const { data: activeCampaign } = useQuery({
    queryKey: ["campaign", activeCampaignId],
    queryFn: () => getCampaign(activeCampaignId as string),
    enabled: !!activeCampaignId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 2500 : false),
  });

  const draftMutation = useMutation({
    mutationFn: () => createCampaign(projectId, goal),
    onSuccess: (campaign) => {
      queryClient.invalidateQueries({ queryKey: ["campaigns", projectId] });
      queryClient.setQueryData(["campaign", campaign.id], campaign);
      setActiveCampaignId(campaign.id);
      setGoal("");
    },
    onError: () => {
      toast.error(t("common.error"));
    },
  });

  const removeStepMutation = useMutation({
    mutationFn: (stepIds: string[]) => updateCampaignPlan(activeCampaignId as string, stepIds),
    onSuccess: (campaign) => {
      queryClient.setQueryData(["campaign", campaign.id], campaign);
    },
    onError: () => {
      toast.error(t("common.error"));
    },
  });

  const runMutation = useMutation({
    mutationFn: () => runCampaign(activeCampaignId as string),
    onSuccess: (campaign) => {
      queryClient.setQueryData(["campaign", campaign.id], campaign);
      queryClient.invalidateQueries({ queryKey: ["campaigns", projectId] });
    },
    onError: () => {
      toast.error(t("common.error"));
    },
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelCampaign(activeCampaignId as string),
    onSuccess: (campaign) => {
      queryClient.setQueryData(["campaign", campaign.id], campaign);
      queryClient.invalidateQueries({ queryKey: ["campaigns", projectId] });
    },
    onError: () => {
      toast.error(t("common.error"));
    },
  });

  function handleDraft() {
    if (!goal.trim() || draftMutation.isPending) return;
    draftMutation.mutate();
  }

  function handleRemoveStep(stepId: string) {
    if (!activeCampaign) return;
    const remainingIds = activeCampaign.steps.filter((s) => s.id !== stepId).map((s) => s.id);
    removeStepMutation.mutate(remainingIds);
  }

  function handleBack() {
    setActiveCampaignId(null);
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-primary text-white shadow-sm">
          <Megaphone className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">{t("campaigns.title")}</h1>
          <p className="text-xs text-muted-foreground leading-tight">{t("campaigns.subtitle")}</p>
        </div>
      </div>

      {!activeCampaign ? (
        <>
          <Card className="p-5">
            <label className="text-sm font-semibold text-foreground" htmlFor="campaign-goal">
              {t("campaigns.newGoal")}
            </label>
            <textarea
              id="campaign-goal"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder={t("campaigns.goalPlaceholder")}
              rows={3}
              className="mt-2 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <div className="mt-3 flex justify-end">
              <button
                onClick={handleDraft}
                disabled={!goal.trim() || draftMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {draftMutation.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("campaigns.drafting")}
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5" /> {t("campaigns.draft")}
                  </>
                )}
              </button>
            </div>
          </Card>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {t("campaigns.yourCampaigns")}
            </p>
            {campaigns.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">{t("campaigns.empty")}</Card>
            ) : (
              <div className="flex flex-col gap-2">
                {campaigns.map((c) => (
                  <Card
                    key={c.id}
                    interactive
                    onClick={() => setActiveCampaignId(c.id)}
                    className="flex items-center justify-between gap-3 p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{c.goal}</p>
                      {c.director_summary && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.director_summary}</p>
                      )}
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", CAMPAIGN_STATUS_BADGE[c.status])}>
                      {t(`campaigns.status.${c.status}`)}
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-4">
          <button
            onClick={handleBack}
            className="flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> {t("campaigns.back")}
          </button>

          <Card className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">{activeCampaign.goal}</p>
                {activeCampaign.director_summary && (
                  <p className="mt-1 text-xs text-muted-foreground">{activeCampaign.director_summary}</p>
                )}
              </div>
              <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold", CAMPAIGN_STATUS_BADGE[activeCampaign.status])}>
                {t(`campaigns.status.${activeCampaign.status}`)}
              </span>
            </div>

            {activeCampaign.status === "planned" && (
              <p className="mt-3 text-xs font-semibold text-foreground">{t("campaigns.planReady")}</p>
            )}
          </Card>

          <div className="flex flex-col gap-2">
            {activeCampaign.steps.map((step) => {
              const StatusIcon = STEP_STATUS_ICON[step.status];
              return (
                <Card key={step.id} className="flex items-start gap-3 p-4">
                  <StatusIcon
                    className={cn(
                      "mt-0.5 h-4 w-4 shrink-0",
                      STEP_STATUS_COLOR[step.status],
                      step.status === "running" && "animate-spin",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-foreground">{step.agent}</p>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {step.action}
                      </span>
                      <span className={cn("ml-auto text-[10px] font-semibold", STEP_STATUS_COLOR[step.status])}>
                        {t(`campaigns.stepStatus.${step.status}`)}
                      </span>
                    </div>
                    {step.why && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground/70">{t("campaigns.why")}:</span> {step.why}
                      </p>
                    )}
                    {step.summary && (
                      <p className="mt-1 text-xs text-muted-foreground">{step.summary}</p>
                    )}
                    {step.error && (
                      <p className="mt-1 text-xs text-destructive">{step.error}</p>
                    )}
                  </div>
                  {activeCampaign.status === "planned" && (
                    <button
                      onClick={() => handleRemoveStep(step.id)}
                      disabled={removeStepMutation.isPending}
                      title={t("campaigns.remove")}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </Card>
              );
            })}
          </div>

          <div className="flex justify-end gap-2">
            {activeCampaign.status === "planned" && (
              <button
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || activeCampaign.steps.length === 0}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {runMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {t("campaigns.run")}
              </button>
            )}
            {activeCampaign.status === "running" && (
              <button
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Ban className="h-3.5 w-3.5" />
                )}
                {t("campaigns.cancel")}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
