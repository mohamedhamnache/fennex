"use client";

import { useState, useEffect } from "react";
import { AlertCircle, CheckCircle2, Clock, Play } from "lucide-react";
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

function SeverityBadge({ severity }: { severity: AuditIssue["severity"] }) {
  const styles: Record<AuditIssue["severity"], string> = {
    critical: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400",
    warning: "bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400",
    info: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
  };
  return (
    <span className={`badge ${styles[severity]}`}>
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}

export default function AuditPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
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
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">SEO Audit</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Crawl your site and surface technical issues, content gaps, and on-page improvements.
          </p>
        </div>
        <button
          onClick={runAudit}
          disabled={isRunning}
          className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
        >
          {isRunning ? (
            <>
              <Spinner size={14} />
              Running…
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Run Audit
            </>
          )}
        </button>
      </div>

      {/* ── Idle state ── */}
      {phase === "idle" && (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <FennecMascot />
          <div className="text-center">
            <p className="text-base font-semibold text-foreground">No audit yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Click <strong>Run Audit</strong> to crawl your site and get a full SEO report.
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
              {phase === "crawling" ? "Crawling pages…" : "Analysing SEO signals…"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{statusMessage}</p>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted-foreground mt-2">
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${phase === "crawling" ? "bg-primary animate-pulse-dot" : "bg-emerald-500"}`}
              />
              Crawl
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${phase === "auditing" ? "bg-primary animate-pulse-dot" : "bg-border"}`}
              />
              Audit
            </span>
          </div>
        </div>
      )}

      {/* ── Error state ── */}
      {phase === "error" && errorMessage && (
        <div className="card-base p-5 flex items-start gap-3 border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800/30">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">Audit failed</p>
            <p className="mt-0.5 text-xs text-red-500/80 dark:text-red-400/70">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* ── Done state ── */}
      {phase === "done" && auditResult && (
        <>
          {/* Success banner */}
          <div className="card-base p-4 flex items-center gap-3 border-emerald-200 bg-emerald-50 dark:bg-emerald-900/10 dark:border-emerald-800/30">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              Audit completed successfully
            </p>
          </div>

          {/* Score gauges */}
          <div className="card-base p-6">
            <h2 className="mb-5 text-sm font-semibold text-foreground">Score Overview</h2>
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <ScoreGauge score={auditResult.overall_score} label="Overall" />
              <ScoreGauge score={auditResult.technical_score} label="Technical" />
              <ScoreGauge score={auditResult.content_score} label="Content" />
              <ScoreGauge score={auditResult.onpage_score} label="On-Page" />
            </div>
          </div>

          {/* Summary stats */}
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                label: "Pages Audited",
                value: auditResult.summary?.pages_audited ?? 0,
                icon: Clock,
                accent: "accent-indigo",
              },
              {
                label: "Critical Issues",
                value: auditResult.summary?.critical_issues ?? 0,
                icon: AlertCircle,
                accent: "accent-amber",
              },
              {
                label: "Warnings",
                value: auditResult.summary?.warnings ?? 0,
                icon: AlertCircle,
                accent: "accent-violet",
              },
            ].map((stat) => (
              <div key={stat.label} className={`card-base card-shadow p-5 ${stat.accent}`}>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="mt-1 text-2xl font-bold text-foreground">{stat.value}</p>
              </div>
            ))}
          </div>

          {/* Issues table */}
          {auditResult.issues && auditResult.issues.length > 0 && (
            <div className="card-base overflow-hidden">
              <div className="border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold text-foreground">
                  Issues ({auditResult.issues.length})
                </h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">
                        Severity
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">
                        Issue Type
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">
                        URL
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">
                        Details
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
            </div>
          )}

          {auditResult.issues?.length === 0 && (
            <div className="card-base p-8 flex flex-col items-center gap-3 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
              <p className="text-sm font-semibold text-foreground">No issues found</p>
              <p className="text-xs text-muted-foreground">
                Your site is in great shape — no SEO issues detected.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
