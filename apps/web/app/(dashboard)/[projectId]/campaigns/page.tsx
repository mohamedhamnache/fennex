"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Megaphone } from "lucide-react";
import {
  createCampaign, listCampaigns, getCampaign, updateCampaignPlan,
  runCampaign, cancelCampaign, type Campaign,
} from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { CampaignCanvas } from "@/components/campaigns/CampaignCanvas";
import { CampaignComposer } from "@/components/campaigns/CampaignComposer";
import { StepPanel } from "@/components/campaigns/StepPanel";
import { LiveFeed } from "@/components/campaigns/LiveFeed";
import { PackagePanel } from "@/components/campaigns/PackagePanel";
import { sumEstimates, fmtEstimate } from "@/lib/campaignMeta";

const CAMPAIGN_STATUS_BADGE: Record<Campaign["status"], string> = {
  planned: "bg-muted text-muted-foreground",
  running: "bg-primary/12 text-primary",
  completed: "bg-success/12 text-success",
  failed: "bg-destructive/12 text-destructive",
  cancelled: "bg-muted text-muted-foreground",
};

function statusBadgeClass(status: Campaign["status"]): string {
  return cn("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold", CAMPAIGN_STATUS_BADGE[status]);
}

export default function CampaignsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [goal, setGoal] = useState("");
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

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
      setSelectedStepId(null);
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

  function handleRemoveStep(stepId: string) {
    if (!activeCampaign) return;
    const remainingIds = activeCampaign.steps.filter((s) => s.id !== stepId).map((s) => s.id);
    removeStepMutation.mutate(remainingIds);
  }

  function handleBack() {
    setActiveCampaignId(null);
    setSelectedStepId(null);
  }

  const selectedStep = activeCampaign?.steps.find((s) => s.id === selectedStepId) ?? null;
  const activeStepId = activeCampaign
    ? activeCampaign.status === "running"
      ? (activeCampaign.steps.find((s) => s.status === "running") ??
         activeCampaign.steps.filter((s) => s.status === "pending").sort((a, b) => a.order - b.order)[0])?.id ?? null
      : null
    : null;

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
        <CampaignComposer
          projectId={projectId}
          campaigns={campaigns}
          goal={goal}
          setGoal={setGoal}
          onDraft={() => draftMutation.mutate()}
          drafting={draftMutation.isPending}
          onOpenCampaign={(id) => setActiveCampaignId(id)}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={handleBack}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent"
            >
              {t("campaigns.back")}
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-bold text-foreground">{activeCampaign.goal}</h2>
              {activeCampaign.director_summary && activeCampaign.status === "planned" && (
                <p className="truncate text-xs text-muted-foreground">
                  {t("campaigns.canvas.directorNote")}: {activeCampaign.director_summary}
                </p>
              )}
            </div>
            <span className={statusBadgeClass(activeCampaign.status)}>
              {t(`campaigns.status.${activeCampaign.status}`)}
            </span>
          </div>

          <div className="flex gap-4">
            <div className="min-w-0 flex-1">
              <CampaignCanvas
                campaign={activeCampaign}
                activeStepId={activeStepId}
                selectedStepId={selectedStepId}
                onSelectStep={setSelectedStepId}
              />
            </div>
            {selectedStep && (
              <div className="w-72 shrink-0">
                <StepPanel
                  step={selectedStep}
                  campaign={activeCampaign}
                  onClose={() => setSelectedStepId(null)}
                  onRemove={handleRemoveStep}
                  removing={removeStepMutation.isPending}
                />
              </div>
            )}
          </div>

          {activeCampaign.status === "planned" && (
            <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-3">
              <p className="text-xs text-muted-foreground">
                {t("campaigns.canvas.estimatedTotal")}:{" "}
                <span className="font-semibold text-foreground">
                  {fmtEstimate(sumEstimates(activeCampaign.steps.map((s) => s.action)), t("campaigns.canvas.minutes"))}
                </span>
                <span className="ml-2">
                  {t("campaigns.canvas.stepsDone", { done: 0, total: activeCampaign.steps.length })}
                </span>
              </p>
              <button
                onClick={() => runMutation.mutate()}
                disabled={runMutation.isPending || activeCampaign.steps.length === 0}
                className="btn-primary px-5 py-2 text-sm"
              >
                {t("campaigns.canvas.launch")}
              </button>
            </div>
          )}
          {activeCampaign.status === "running" && (
            <LiveFeed
              campaign={activeCampaign}
              onCancel={() => cancelMutation.mutate()}
              cancelling={cancelMutation.isPending}
            />
          )}
          {activeCampaign.status !== "planned" && activeCampaign.status !== "running" && (
            <PackagePanel
              projectId={projectId}
              campaign={activeCampaign}
              onRunAgain={(g) => {
                setActiveCampaignId(null);
                setSelectedStepId(null);
                setGoal(g);
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
