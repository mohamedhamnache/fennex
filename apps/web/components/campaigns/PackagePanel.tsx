"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, Loader2, Radar } from "lucide-react";
import {
  createCalendarEntry,
  getImage,
  listArticles,
  type Campaign,
  type CampaignStep,
} from "@/lib/api";
import { agentVisual } from "@/lib/campaignMeta";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

interface PackagePanelProps {
  projectId: string;
  campaign: Campaign;
  onRunAgain: (goal: string) => void;
}

function nextMorningISO(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

function AgentChip({ agent }: { agent: string }) {
  const visual = agentVisual(agent);
  return (
    <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white", visual.gradient)}>
      <visual.Icon className="h-3.5 w-3.5" strokeWidth={2} />
    </span>
  );
}

function ShipButton({
  shipped,
  shipping,
  onShip,
  calendarHref,
}: {
  shipped: boolean;
  shipping: boolean;
  onShip: () => void;
  calendarHref: string;
}) {
  const { t } = useTranslation();

  if (shipped) {
    return (
      <Link
        href={calendarHref}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 text-xs font-medium text-success transition-colors hover:bg-success/15"
      >
        {t("campaigns.ship.shipped")}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onShip}
      disabled={shipping}
      className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      {shipping && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {t("campaigns.ship.ship")}
    </button>
  );
}

function DetailCard({ step, agent }: { step: CampaignStep; agent: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const content = String(step.structured?.markdown ?? step.summary ?? "");

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2.5">
        <AgentChip agent={agent} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{t("campaigns.viewDetails")}</p>
      </div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
      >
        {t("campaigns.viewDetails")}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
      </button>
      {expanded && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/50 p-3 text-xs text-foreground">
          {content || t("campaigns.noDetails")}
        </pre>
      )}
    </Card>
  );
}

export function PackagePanel({ projectId, campaign, onRunAgain }: PackagePanelProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [shippedStepIds, setShippedStepIds] = useState<Set<string>>(new Set());

  const { data: articles = [] } = useQuery({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
    staleTime: 30_000,
  });

  const shipMutation = useMutation({
    mutationFn: (step: CampaignStep) => {
      if (step.artifact_type === "article") {
        return createCalendarEntry(projectId, {
          content_type: "article",
          content_id: step.artifact_ids![0],
          scheduled_at: nextMorningISO(1),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      }
      return createCalendarEntry(projectId, {
        content_type: "banner",
        content_id: String(step.structured!.image_id),
        scheduled_at: nextMorningISO(2),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    },
    onSuccess: (_entry, step) => {
      setShippedStepIds((prev) => new Set(prev).add(step.id));
      queryClient.invalidateQueries({ queryKey: ["calendar"] });
    },
    onError: () => {
      toast.error(t("campaigns.ship.shipFailed"));
    },
  });

  const artifactSteps = campaign.steps.filter((s) => s.status === "completed" && s.artifact_type);
  const doneCount = campaign.steps.filter((s) => s.status === "completed").length;

  const keyword = campaign.steps.find(
    (s) => s.status === "completed" && (s.structured as Record<string, unknown> | null)?.keyword,
  )?.structured?.keyword as string | undefined;
  const showTrackingChip = campaign.status === "completed" && !!keyword;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
          {t("campaigns.canvas.stepsDone", { done: doneCount, total: campaign.steps.length })}
        </span>
        <button
          type="button"
          onClick={() => onRunAgain(campaign.goal)}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          {t("campaigns.composer.runAgain")}
        </button>
      </div>

      {showTrackingChip && (
        <div className="flex items-start gap-3 rounded-2xl bg-gradient-to-br from-indigo-500/10 to-violet-500/10 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-white">
            <Radar className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-foreground">{t("campaigns.trackingChip.title")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("campaigns.trackingChip.body", { keyword })}
            </p>
            <Link
              href={`/${projectId}/agents/tracking`}
              className="mt-1.5 inline-block text-xs font-semibold text-primary hover:underline"
            >
              {t("campaigns.trackingChip.view")}
            </Link>
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {t("campaigns.package")}
        </p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {artifactSteps.map((step) => {
            switch (step.artifact_type) {
              case "article":
                return (
                  <ArticleCard
                    key={step.id}
                    projectId={projectId}
                    step={step}
                    article={articles.find((a) => a.id === step.artifact_ids?.[0])}
                    shipped={shippedStepIds.has(step.id)}
                    shipping={shipMutation.isPending && shipMutation.variables?.id === step.id}
                    onShip={() => shipMutation.mutate(step)}
                  />
                );
              case "image":
                return (
                  <ImageCard
                    key={step.id}
                    projectId={projectId}
                    step={step}
                    shipped={shippedStepIds.has(step.id)}
                    shipping={shipMutation.isPending && shipMutation.variables?.id === step.id}
                    onShip={() => shipMutation.mutate(step)}
                  />
                );
              case "social":
                return <SocialCard key={step.id} projectId={projectId} step={step} />;
              case "report":
              case "analysis":
                return <DetailCard key={step.id} step={step} agent={step.agent} />;
              default:
                return null;
            }
          })}
        </div>
      </div>
    </div>
  );
}

function ArticleCard({
  projectId,
  step,
  article,
  shipped,
  shipping,
  onShip,
}: {
  projectId: string;
  step: CampaignStep;
  article: { title: string; word_count: number; seo_score: number | null } | undefined;
  shipped: boolean;
  shipping: boolean;
  onShip: () => void;
}) {
  const { t } = useTranslation();
  const title = article?.title ?? String(step.structured?.title ?? "");

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2.5">
        <AgentChip agent={step.agent} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</p>
      </div>
      {article && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{t("campaigns.composer.wordCount", { count: article.word_count })}</span>
          {article.seo_score != null && (
            <>
              <span>&middot;</span>
              <span>{t("campaigns.composer.seoScore", { score: article.seo_score })}</span>
            </>
          )}
        </div>
      )}
      <div className="mt-auto flex items-center gap-2">
        <ShipButton
          shipped={shipped}
          shipping={shipping}
          onShip={onShip}
          calendarHref={`/${projectId}/calendar`}
        />
        <Link
          href={`/${projectId}/articles`}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
        >
          {t("campaigns.composer.openArticle")}
        </Link>
      </div>
    </Card>
  );
}

function ImageCard({
  projectId,
  step,
  shipped,
  shipping,
  onShip,
}: {
  projectId: string;
  step: CampaignStep;
  shipped: boolean;
  shipping: boolean;
  onShip: () => void;
}) {
  const { t } = useTranslation();
  const imageId = typeof step.structured?.image_id === "string" ? step.structured.image_id : null;
  const { data: image } = useQuery({
    queryKey: ["campaign-image", imageId],
    queryFn: () => getImage(imageId as string),
    enabled: !!imageId,
    staleTime: 60_000,
  });

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2.5">
        <AgentChip agent={step.agent} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {step.summary ?? t("campaigns.viewImages")}
        </p>
      </div>
      {image && (image.thumbnail_url ?? image.image_url) && (
        <div className="overflow-hidden rounded-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.thumbnail_url ?? image.image_url ?? undefined}
            alt={image.alt_text ?? ""}
            className="h-40 w-full object-cover"
          />
        </div>
      )}
      <div className="mt-auto flex items-center gap-2">
        <ShipButton
          shipped={shipped}
          shipping={shipping}
          onShip={onShip}
          calendarHref={`/${projectId}/calendar`}
        />
      </div>
    </Card>
  );
}

function SocialCard({ projectId, step }: { projectId: string; step: CampaignStep }) {
  const { t } = useTranslation();

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center gap-2.5">
        <AgentChip agent={step.agent} />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{t("campaigns.viewSocial")}</p>
      </div>
      {step.summary && <p className="text-xs text-muted-foreground">{step.summary}</p>}
      <Link
        href={`/${projectId}/social`}
        className="mt-auto flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        {t("campaigns.composer.reviewSocial")}
      </Link>
    </Card>
  );
}
