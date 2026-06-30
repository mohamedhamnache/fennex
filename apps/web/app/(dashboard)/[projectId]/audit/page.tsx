"use client";

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Clock, Play, SearchCode } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { ScoreGauge } from "@/components/ui/ScoreGauge";
import {
  triggerCrawl,
  getCrawlStatus,
  triggerAudit,
  getAuditStatus,
  listProjects,
  type AuditResult,
  type AuditIssue,
} from "@/lib/api";
import { useProjectStore } from "@/lib/store";
import { FennecMascot } from "@fennex/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { Badge, type BadgeTone } from "@/components/ui/Badge";

type FlowState = "idle" | "crawling" | "auditing" | "done" | "error";

function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="animate-spin"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      width={size}
      height={size}
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

const SEVERITY_TONE: Record<AuditIssue["severity"], BadgeTone> = {
  critical: "danger",
  warning: "warning",
  info: "info",
};

function SeverityBadge({ severity }: { severity: AuditIssue["severity"] }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]}>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </Badge>
  );
}

export default function AuditPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { t } = useTranslation();
  const { setCurrentProject } = useProjectStore();

  const [phase, setPhase] = useState<FlowState>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [crawlJobId, setCrawlJobId] = useState<string | null>(null);
  const [auditId, setAuditId] = useState<string | null>(null);

  // Sync current project to store when navigating directly via URL
  useEffect(() => {
    setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  // Query projects list so runAudit can use cache instead of a fresh fetch
  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 30_000,
  });

  // Poll crawl job status
  const crawlQuery = useQuery({
    queryKey: ["crawl", crawlJobId],
    queryFn: () => getCrawlStatus(crawlJobId!),
    enabled: !!crawlJobId && phase === "crawling",
    refetchInterval: phase === "crawling" ? 2000 : false,
  });

  // Poll audit status
  const auditQuery = useQuery({
    queryKey: ["audit", auditId],
    queryFn: () => getAuditStatus(auditId!),
    enabled: !!auditId && phase === "auditing",
    refetchInterval: phase === "auditing" ? 2000 : false,
  });

  // Advance phase when crawl completes
  useEffect(() => {
    if (!crawlQuery.data || phase !== "crawling") return;
    if (crawlQuery.data.status === "completed") {
      setPhase("auditing");
      setStatusMessage("Starting audit analysis…");
      // Trigger audit job
      triggerAudit(projectId, crawlJobId!)
        .then((resp) => {
          setAuditId(resp.audit_id);
        })
        .catch((err) => {
          setPhase("error");
          setErrorMessage(err instanceof Error ? err.message : "Failed to start audit");
        });
    } else if (crawlQuery.data.status === "failed") {
      setPhase("error");
      setErrorMessage(crawlQuery.data.error ?? "Crawl failed");
    } else {
      setStatusMessage(`Crawling pages… ${crawlQuery.data.pages_crawled ?? 0} pages found`);
    }
  }, [crawlQuery.data, phase, projectId, crawlJobId]);

  // Advance phase when audit completes
  useEffect(() => {
    if (!auditQuery.data || phase !== "auditing") return;
    if (auditQuery.data.status === "completed") {
      setAuditResult(auditQuery.data);
      setPhase("done");
      setStatusMessage("Audit complete");
    } else if (auditQuery.data.status === "failed") {
      setPhase("error");
      setErrorMessage("Audit failed");
    } else {
      setStatusMessage("Analyzing SEO signals…");
    }
  }, [auditQuery.data, phase]);

  async function runAudit() {
    if (phase !== "idle" && phase !== "error" && phase !== "done") return;

    setPhase("crawling");
    setStatusMessage("Starting crawler…");
    setAuditResult(null);
    setErrorMessage(null);
    setCrawlJobId(null);
    setAuditId(null);

    try {
      // Resolve project domain from cache (populated by the projects query above)
      const project = projects?.find((p) => p.id === projectId);
      if (!project) throw new Error("Project not found");

      // Trigger crawl; polling is handled by crawlQuery
      const crawlResp = await triggerCrawl(projectId, project.domain);
      setCrawlJobId(crawlResp.job_id);
    } catch (err) {
      setPhase("error");
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const isRunning = phase === "crawling" || phase === "auditing";

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        title={t("audit.title")}
        icon={SearchCode}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: t("audit.audit") }]}
        description={t("audit.subtitle")}
        actions={
          <button
            onClick={runAudit}
            disabled={isRunning}
            className="btn-primary flex items-center gap-2 px-3.5 py-2 text-xs"
          >
            {isRunning ? (
              <>
                <Spinner size={13} />
                {t("audit.running")}
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                {t("audit.runAudit")}
              </>
            )}
          </button>
        }
      />

      {/* ── Idle state ── */}
      {phase === "idle" && (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <FennecMascot />
          <div className="text-center">
            <p className="text-base font-semibold text-foreground">{t("audit.noAudit")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("audit.noAuditHint")}
            </p>
          </div>
        </div>
      )}

      {/* ── Running state ── */}
      {isRunning && (
        <div className="card-base p-8 flex flex-col items-center gap-4">
          <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <Spinner size={28} />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">
              {phase === "crawling" ? t("audit.crawlingPages") : t("audit.analysingSignals")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{statusMessage}</p>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted-foreground mt-2">
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${phase === "crawling" ? "bg-primary animate-pulse-dot" : "bg-emerald-500"}`}
              />
              {t("audit.crawl")}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${phase === "auditing" ? "bg-primary animate-pulse-dot" : "bg-border"}`}
              />
              {t("audit.audit")}
            </span>
          </div>
        </div>
      )}

      {/* ── Error state ── */}
      {phase === "error" && errorMessage && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-destructive">{t("audit.auditFailed")}</p>
            <p className="mt-0.5 text-xs text-destructive/80">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* ── Done state ── */}
      {phase === "done" && auditResult && (
        <>
          {/* Success banner */}
          <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-4">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
            <p className="text-sm font-medium text-success">
              {t("audit.auditSuccess")}
            </p>
          </div>

          {/* Score gauges */}
          <Card className="p-6">
            <h2 className="mb-5 text-sm font-semibold text-foreground">{t("audit.scoreOverview")}</h2>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <ScoreGauge score={auditResult.overall_score} label={t("audit.scores.overall")} />
              <ScoreGauge score={auditResult.technical_score} label={t("audit.scores.technical")} />
              <ScoreGauge score={auditResult.content_score} label={t("audit.scores.content")} />
              <ScoreGauge score={auditResult.onpage_score} label={t("audit.scores.onPage")} />
            </div>
          </Card>

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard label={t("audit.stats.pagesAudited")} tone="primary" icon={Clock}
              value={String(auditResult.summary?.pages_audited ?? 0)} />
            <StatCard label={t("audit.stats.criticalIssues")} tone="amber" icon={AlertCircle}
              value={String(auditResult.summary?.critical_issues ?? 0)} />
            <StatCard label={t("audit.stats.warnings")} tone="violet" icon={AlertCircle}
              value={String(auditResult.summary?.warnings ?? 0)} />
          </div>

          {/* Issues table */}
          {auditResult.issues && auditResult.issues.length > 0 && (
            <Card className="overflow-hidden">
              <div className="border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  {t("audit.issuesCount", { n: auditResult.issues.length })}
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">
                        {t("audit.tableHeaders.severity")}
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">
                        {t("audit.tableHeaders.issueType")}
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">
                        {t("audit.tableHeaders.url")}
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">
                        {t("audit.tableHeaders.details")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditResult.issues.map((issue, idx) => (
                      <tr
                        key={idx}
                        className="border-b border-border/50 last:border-0 even:bg-muted/30 transition-colors hover:bg-accent/50"
                      >
                        <td className="px-5 py-3">
                          <SeverityBadge severity={issue.severity} />
                        </td>
                        <td className="px-5 py-3 font-medium text-foreground">
                          {issue.issue_type}
                        </td>
                        <td className="max-w-[200px] truncate px-5 py-3 text-xs text-muted-foreground">
                          <a
                            href={issue.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary hover:underline"
                          >
                            {issue.url}
                          </a>
                        </td>
                        <td className="px-5 py-3 text-xs text-muted-foreground">{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {auditResult.issues?.length === 0 && (
            <Card className="p-8 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-8 w-8 text-success" />
              <p className="text-sm font-semibold text-foreground">{t("audit.noIssues")}</p>
              <p className="text-xs text-muted-foreground">
                {t("audit.noIssuesHint")}
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
