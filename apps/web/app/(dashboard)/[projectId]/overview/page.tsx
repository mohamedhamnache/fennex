"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FileText, ExternalLink, Globe } from "lucide-react";
import Link from "next/link";
import {
  listProjects,
  listArticles,
  type Article,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { MissionControl } from "@/components/projects/MissionControl";
import { PersonaHomeSection } from "@/components/projects/PersonaHomeSection";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, BadgeTone> = {
  draft: "neutral",
  generating: "warning",
  ready: "info",
  published: "success",
  failed: "danger",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ProjectOverviewPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t, i18n } = useTranslation();

  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 30_000,
  });

  const { data: articles = [], isLoading: articlesLoading } = useQuery({
    queryKey: ["articles", projectId],
    queryFn: () => listArticles(projectId),
    staleTime: 60_000,
  });

  const project = projects.find((p) => p.id === projectId);
  const recentArticles = [...articles]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        title={project?.name ?? t("overview.title")}
        icon={Globe}
        breadcrumbs={[{ label: t("overview.dashboard"), href: "/" }, { label: project?.name ?? t("overview.project") }]}
        description={
          project?.domain ? (
            <a
              href={`https://${project.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
            >
              {project.domain}
              <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            t("overview.subtitle")
          )
        }
        actions={
          <Link href={`/${projectId}/articles`} className="btn-primary inline-flex items-center gap-1.5 px-3.5 py-2 text-xs">
            <FileText className="h-3.5 w-3.5" /> {t("overview.newArticle")}
          </Link>
        }
      />

      {/* Persona-driven sections — gated until the project is loaded so we never
          flash the default "creator" layout before the real persona is known. */}
      {projectsLoading || !project ? (
        <div className="flex flex-col gap-6">
          <div className="h-40 rounded-xl border bg-muted/20 animate-pulse" />
          <div className="h-64 rounded-xl border bg-muted/20 animate-pulse" />
        </div>
      ) : (
        <>
          <MissionControl projectId={projectId} persona={project.persona ?? "creator"} />
          <PersonaHomeSection projectId={projectId} persona={project.persona ?? "creator"} />
        </>
      )}

      <div className="grid grid-cols-1 gap-6">
        {/* Recent articles */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">{t("overview.recentArticles")}</h2>
            <Link href={`/${projectId}/articles`} className="text-xs text-muted-foreground transition-colors hover:text-foreground">
              {t("overview.viewAll")}
            </Link>
          </div>
          <Card className="overflow-hidden">
            {articlesLoading ? (
              <div className="space-y-3 p-6">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-8 animate-pulse rounded bg-muted/30" />
                ))}
              </div>
            ) : recentArticles.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t("overview.noArticles")}{" "}
                <Link href={`/${projectId}/articles`} className="text-primary hover:underline">
                  {t("overview.createOne")}
                </Link>
              </div>
            ) : (
              <table className="w-full text-sm">
                <tbody>
                  {recentArticles.map((article: Article) => (
                    <tr key={article.id} className="border-b transition-colors last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <Link href={`/${projectId}/articles`} className="line-clamp-1 font-medium hover:underline">
                          {article.title}
                        </Link>
                        {article.target_keyword && (
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">{article.target_keyword}</p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Badge tone={STATUS_TONE[article.status] ?? "neutral"}>
                          {t(`overview.status.${article.status}`, { defaultValue: article.status })}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-xs text-muted-foreground">
                        {new Date(article.created_at).toLocaleDateString(i18n.language, { month: "short", day: "numeric" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
