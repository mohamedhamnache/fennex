"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { getSeoProviderStatus, listProjects, listTrackedKeywords } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProviderGate } from "@/components/seo/ProviderGate";
import { AddKeywordBar } from "@/components/seo/AddKeywordBar";
import { RankTrackerTable } from "@/components/seo/RankTrackerTable";
import { KeywordDrawer } from "@/components/seo/KeywordDrawer";
import { useToast } from "@/components/ui/Toast";

export default function SeoHubPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const { warning: showWarning } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ["seo-provider", projectId],
    queryFn: () => getSeoProviderStatus(projectId),
    staleTime: 60_000,
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["seo-keywords", projectId],
    queryFn: () => listTrackedKeywords(projectId),
    staleTime: 60_000,
    enabled: !!status?.connected,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
  });
  const project = projects.find((p) => p.id === projectId);

  function handleGateHit() {
    showWarning(t("seoHub.gate.title"), { message: t("seoHub.gate.body") });
  }

  return (
    <div>
      <PageHeader icon={TrendingUp} title={t("seoHub.title")} description={t("seoHub.subtitle")} />

      {statusLoading ? (
        <div className="h-64 animate-pulse rounded-xl border bg-muted/30" />
      ) : !status?.connected ? (
        <ProviderGate />
      ) : (
        <div className="flex flex-col gap-4">
          <AddKeywordBar projectId={projectId} count={rows.length} />

          <div className="flex gap-4">
            <div className="min-w-0 flex-1">
              <RankTrackerTable
                projectId={projectId}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onGateHit={handleGateHit}
              />
            </div>
            {selectedId && (
              <div className="w-80 shrink-0">
                <KeywordDrawer
                  keywordId={selectedId}
                  domain={project?.domain}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
