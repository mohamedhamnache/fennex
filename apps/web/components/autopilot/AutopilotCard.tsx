"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Rocket, ArrowRight, CalendarCheck2, Loader2 } from "lucide-react";
import { listCampaigns } from "@/lib/api";
import { sumEstimates, fmtEstimate } from "@/lib/campaignMeta";
import { Card } from "@/components/ui/Card";

function mondayISO(d: Date): string {
  const day = (d.getDay() + 6) % 7; // Mon=0
  const m = new Date(d);
  m.setDate(d.getDate() - day);
  return m.toISOString().slice(0, 10);
}

export function AutopilotCard({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  const { data: campaigns = [] } = useQuery({
    queryKey: ["campaigns", projectId],
    queryFn: () => listCampaigns(projectId),
    staleTime: 60_000,
  });

  const week = mondayISO(new Date());
  const plan = campaigns.find((c) => c.source === "autopilot" && c.week_of === week);
  if (!plan || plan.status === "failed" || plan.status === "cancelled") return null;

  const weekLabel = new Date(week + "T00:00:00").toLocaleDateString(i18n.language, {
    month: "short", day: "numeric",
  });
  const done = plan.steps.filter((s) => s.status === "completed").length;
  const artifacts = plan.steps.filter((s) => s.status === "completed" && s.artifact_type).length;
  const href = `/${projectId}/campaigns?campaign=${plan.id}`;

  return (
    <Card className="flex items-center gap-4 border-primary/20 bg-gradient-to-r from-primary/[0.06] to-transparent p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
        {plan.status === "running"
          ? <Loader2 className="h-4.5 w-4.5 animate-spin" strokeWidth={1.9} />
          : plan.status === "completed"
            ? <CalendarCheck2 className="h-4.5 w-4.5" strokeWidth={1.9} />
            : <Rocket className="h-4.5 w-4.5" strokeWidth={1.9} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {plan.status === "planned" && t("autopilot.titlePlanned")}
          {plan.status === "running" && t("autopilot.titleRunning")}
          {plan.status === "completed" && t("autopilot.titleDone")}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-medium text-primary">{t("autopilot.weekOf", { date: weekLabel })}</span>
          {" · "}
          {plan.status === "planned" && t("autopilot.bodyPlanned", {
            count: plan.steps.length,
            estimate: fmtEstimate(sumEstimates(plan.steps.map((s) => s.action)), t("campaigns.canvas.minutes")),
          })}
          {plan.status === "running" && t("autopilot.progress", { done, total: plan.steps.length })}
          {plan.status === "completed" && t("autopilot.bodyDone", { count: artifacts })}
        </p>
      </div>
      {plan.status === "completed" ? (
        <Link href={`/${projectId}/calendar`} className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent">
          {t("autopilot.viewCalendar")}
        </Link>
      ) : (
        <Link href={href} className="btn-primary inline-flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-xs">
          {plan.status === "planned" ? t("autopilot.review") : t("autopilot.view")}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </Card>
  );
}
