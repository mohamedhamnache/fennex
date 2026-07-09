"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Megaphone, Loader2, Plus, ChevronRight, ChevronDown,
  FileText, Image as ImageIcon, Share2,
} from "lucide-react";
import {
  createCampaign, listCampaigns, getCampaign, updateCampaignPlan,
  runCampaign, cancelCampaign, getImage, type Campaign, type CampaignStep,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { CampaignCanvas } from "@/components/campaigns/CampaignCanvas";
import { StepPanel } from "@/components/campaigns/StepPanel";
import { LiveFeed } from "@/components/campaigns/LiveFeed";
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

function PackageLinkCard({
  href,
  icon: Icon,
  label,
  step,
}: {
  href: string;
  icon: typeof FileText;
  label: string;
  step: CampaignStep;
}) {
  const imageId = typeof step.structured?.image_id === "string" ? step.structured.image_id : null;
  const { data: image } = useQuery({
    queryKey: ["campaign-package-image", imageId],
    queryFn: () => getImage(imageId as string),
    enabled: !!imageId,
    staleTime: 60_000,
  });

  return (
    <Link href={href}>
      <Card interactive className="flex items-center gap-3 p-4">
        {image?.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={image.thumbnail_url}
            alt={image.alt_text ?? label}
            className="h-10 w-10 shrink-0 rounded-md object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-4 w-4" strokeWidth={1.8} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          {step.summary && <p className="truncate text-xs text-muted-foreground">{step.summary}</p>}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Card>
    </Link>
  );
}

function PackageDetailCard({ step, label }: { step: CampaignStep; label: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const markdown = typeof step.structured?.markdown === "string" ? step.structured.markdown : null;

  return (
    <Card className="p-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FileText className="h-4 w-4" strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{label}</p>
          {step.summary && <p className="truncate text-xs text-muted-foreground">{step.summary}</p>}
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-foreground">
          {markdown ?? step.summary ?? t("campaigns.noDetails")}
        </pre>
      )}
    </Card>
  );
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
                    onClick={() => {
                      setActiveCampaignId(c.id);
                      setSelectedStepId(null);
                    }}
                    className="flex items-center justify-between gap-3 p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{c.goal}</p>
                      {c.director_summary && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{c.director_summary}</p>
                      )}
                    </div>
                    <span className={statusBadgeClass(c.status)}>
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
                disabled={runMutation.isPending}
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
            activeCampaign.status === "completed" && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                  {t("campaigns.package")}
                </p>
                {activeCampaign.steps
                  .filter((step) => step.status === "completed" && step.artifact_type)
                  .map((step) => {
                    switch (step.artifact_type) {
                      case "article":
                        return (
                          <PackageLinkCard
                            key={step.id}
                            href={`/${projectId}/articles`}
                            icon={FileText}
                            label={t("campaigns.viewArticle")}
                            step={step}
                          />
                        );
                      case "image":
                        return (
                          <PackageLinkCard
                            key={step.id}
                            href={`/${projectId}/images`}
                            icon={ImageIcon}
                            label={t("campaigns.viewImages")}
                            step={step}
                          />
                        );
                      case "social":
                        return (
                          <PackageLinkCard
                            key={step.id}
                            href={`/${projectId}/social`}
                            icon={Share2}
                            label={t("campaigns.viewSocial")}
                            step={step}
                          />
                        );
                      case "report":
                      case "analysis":
                        return <PackageDetailCard key={step.id} step={step} label={t("campaigns.viewDetails")} />;
                      default:
                        return null;
                    }
                  })}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
