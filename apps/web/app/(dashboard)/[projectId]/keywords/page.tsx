"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, SearchCode, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { FennecMascot } from "@fennex/ui";
import { useProjectStore } from "@/lib/store";
import {
  triggerKeywordResearch,
  getKeywordJobStatus,
  getKeywordResults,
  getKeywordClusters,
  type Keyword,
  type KeywordCluster,
  type KeywordResearchJob,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";

// ─── Spinner ───────────────────────────────────────────────────────────────

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

// ─── DifficultyBar ─────────────────────────────────────────────────────────

function DifficultyBar({ score }: { score: number | null }) {
  if (score === null) return <span className="text-muted-foreground">—</span>;
  const color = score <= 30 ? "#10b981" : score <= 60 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <span className="text-xs tabular-nums">{Math.round(score)}</span>
    </div>
  );
}

// ─── IntentBadge ───────────────────────────────────────────────────────────

const INTENT_TONE: Record<NonNullable<Keyword["intent"]>, BadgeTone> = {
  informational: "info",
  navigational: "primary",
  commercial: "warning",
  transactional: "success",
};

function IntentBadge({ intent }: { intent: Keyword["intent"] }) {
  if (!intent) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge tone={INTENT_TONE[intent]}>
      {intent.charAt(0).toUpperCase() + intent.slice(1)}
    </Badge>
  );
}

// ─── Sort state helpers ────────────────────────────────────────────────────

type SortCol = "volume" | "difficulty" | "cpc";
type SortDir = "asc" | "desc";

function SortIcon({ col, active, dir }: { col: SortCol; active: SortCol; dir: SortDir }) {
  if (col !== active) return <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />;
  return dir === "asc" ? (
    <ChevronUp className="h-3.5 w-3.5" />
  ) : (
    <ChevronDown className="h-3.5 w-3.5" />
  );
}

// ─── Keywords Table ────────────────────────────────────────────────────────

function KeywordsTable({
  keywords,
  activeClusterId,
}: {
  keywords: Keyword[];
  activeClusterId: string | null;
}) {
  const [sortCol, setSortCol] = useState<SortCol>("volume");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(col: SortCol) {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }

  const filtered = useMemo(
    () =>
      activeClusterId ? keywords.filter((kw) => kw.cluster_id === activeClusterId) : keywords,
    [keywords, activeClusterId],
  );

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aVal: number | null;
      let bVal: number | null;
      if (sortCol === "volume") {
        aVal = a.search_volume;
        bVal = b.search_volume;
      } else if (sortCol === "difficulty") {
        aVal = a.difficulty;
        bVal = b.difficulty;
      } else {
        aVal = a.cpc;
        bVal = b.cpc;
      }
      const aNum = aVal ?? -1;
      const bNum = bVal ?? -1;
      return sortDir === "asc" ? aNum - bNum : bNum - aNum;
    });
  }, [filtered, sortCol, sortDir]);

  return (
    <div className="card-base overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">
                Keyword
              </th>
              <th
                className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer select-none"
                onClick={() => handleSort("volume")}
              >
                <span className="flex items-center gap-1">
                  Volume
                  <SortIcon col="volume" active={sortCol} dir={sortDir} />
                </span>
              </th>
              <th
                className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer select-none"
                onClick={() => handleSort("difficulty")}
              >
                <span className="flex items-center gap-1">
                  Difficulty
                  <SortIcon col="difficulty" active={sortCol} dir={sortDir} />
                </span>
              </th>
              <th
                className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer select-none"
                onClick={() => handleSort("cpc")}
              >
                <span className="flex items-center gap-1">
                  CPC
                  <SortIcon col="cpc" active={sortCol} dir={sortDir} />
                </span>
              </th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-muted-foreground">
                Intent
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((kw) => (
              <tr
                key={kw.id}
                className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
              >
                <td className="px-5 py-3 font-medium text-foreground">
                  <span className="flex items-center gap-2">
                    {kw.keyword}
                    {kw.is_seed && <Badge tone="primary">Seed</Badge>}
                  </span>
                </td>
                <td className="px-5 py-3 tabular-nums text-muted-foreground">
                  {kw.search_volume != null
                    ? kw.search_volume.toLocaleString()
                    : "—"}
                </td>
                <td className="px-5 py-3">
                  <DifficultyBar score={kw.difficulty} />
                </td>
                <td className="px-5 py-3 tabular-nums text-muted-foreground">
                  {kw.cpc != null ? `$${kw.cpc.toFixed(2)}` : "—"}
                </td>
                <td className="px-5 py-3">
                  <IntentBadge intent={kw.intent} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Clusters Grid ─────────────────────────────────────────────────────────

function ClustersGrid({
  clusters,
  activeClusterId,
  onClusterClick,
}: {
  clusters: KeywordCluster[];
  activeClusterId: string | null;
  onClusterClick: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {clusters.map((cluster) => {
        const isActive = cluster.id === activeClusterId;
        return (
          <button
            key={cluster.id}
            onClick={() => onClusterClick(cluster.id)}
            className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
              isActive
                ? "border-primary bg-primary/5"
                : "border-border bg-card hover:border-primary/40 hover:bg-accent/30"
            }`}
          >
            <p className="font-semibold text-foreground">{cluster.name}</p>
            {cluster.topic && (
              <p className="mt-0.5 text-xs text-muted-foreground">{cluster.topic}</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              {cluster.keyword_count} keywords &middot;{" "}
              {(cluster.total_volume ?? 0).toLocaleString()} total vol
            </p>
          </button>
        );
      })}
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function KeywordsPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { setCurrentProject } = useProjectStore();

  const [seedInput, setSeedInput] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);

  useEffect(() => {
    setCurrentProject(projectId);
  }, [projectId, setCurrentProject]);

  // Poll job status
  const jobQuery = useQuery<KeywordResearchJob>({
    queryKey: ["keyword-job", jobId],
    queryFn: () => getKeywordJobStatus(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || status === "pending" || status === "running") return 2000;
      return false;
    },
  });

  const jobStatus = jobQuery.data?.status;
  const isDone = jobStatus === "completed";
  const isFailed = jobStatus === "failed";
  const isRunning = !!jobId && (jobStatus === "pending" || jobStatus === "running" || !jobStatus);

  // Fetch results once done
  const keywordsQuery = useQuery<Keyword[]>({
    queryKey: ["keyword-results", jobId],
    queryFn: () => getKeywordResults(jobId!),
    enabled: isDone,
  });

  const clustersQuery = useQuery<KeywordCluster[]>({
    queryKey: ["keyword-clusters", jobId],
    queryFn: () => getKeywordClusters(jobId!),
    enabled: isDone,
  });

  const keywords = keywordsQuery.data ?? [];
  const clusters = clustersQuery.data ?? [];

  async function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    const seed = seedInput.trim();
    if (!seed) return;

    setIsSubmitting(true);
    setSubmitError(null);
    setJobId(null);
    setActiveClusterId(null);

    try {
      const resp = await triggerKeywordResearch(projectId, seed);
      setJobId(resp.job_id);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to start research");
    } finally {
      setIsSubmitting(false);
    }
  }

  const seedKeyword = jobQuery.data?.seed_keyword ?? seedInput.trim();
  const activeCluster = clusters.find((c) => c.id === activeClusterId) ?? null;
  const filteredCount = activeClusterId
    ? keywords.filter((k) => k.cluster_id === activeClusterId).length
    : keywords.length;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <PageHeader
        title="Keywords"
        icon={SearchCode}
        breadcrumbs={[{ label: "Dashboard", href: "/" }, { label: "Keywords" }]}
        description="Discover high-ROI keyword opportunities and group them into clusters."
      />

      {/* Seed input */}
      <form onSubmit={handleAnalyze} className="card-base p-4 flex gap-3 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={seedInput}
            onChange={(e) => setSeedInput(e.target.value)}
            placeholder="e.g. content marketing"
            disabled={isRunning || isSubmitting}
            className="w-full rounded-lg border border-border bg-input pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60"
          />
        </div>
        <button
          type="submit"
          disabled={!seedInput.trim() || isRunning || isSubmitting}
          className="btn-primary flex items-center gap-2 px-4 py-2 text-sm"
        >
          {isSubmitting || isRunning ? (
            <>
              <Spinner size={14} />
              {isSubmitting ? "Starting…" : "Analyzing…"}
            </>
          ) : (
            "Analyze"
          )}
        </button>
      </form>

      {/* Submit error */}
      {submitError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">{submitError}</p>
        </div>
      )}

      {/* ── Idle state ── */}
      {!jobId && !isSubmitting && (
        <div className="flex flex-col items-center justify-center gap-4 py-20">
          <FennecMascot />
          <div className="text-center">
            <p className="text-base font-semibold text-foreground">Enter a keyword to start</p>
            <p className="mt-1 text-sm text-muted-foreground">
              We&apos;ll research related keywords and group them into clusters.
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
              Analyzing &ldquo;{seedKeyword}&rdquo;&hellip;
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Discovering keywords and building clusters
            </p>
          </div>
        </div>
      )}

      {/* ── Failed state ── */}
      {isFailed && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5">
          <div>
            <p className="text-sm font-semibold text-destructive">Research failed</p>
            <p className="mt-0.5 text-xs text-destructive/80">
              {jobQuery.data?.error ?? "An unexpected error occurred. Please try again."}
            </p>
          </div>
        </div>
      )}

      {/* ── Done state — clusters rail + table ── */}
      {isDone && (
        <div className="flex flex-col gap-4 lg:flex-row">
          {/* Clusters rail */}
          <aside className="glass shrink-0 self-start overflow-hidden lg:w-64">
            <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
              <p className="text-sm font-semibold">Clusters</p>
              <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-xs text-muted-foreground">{clusters.length}</span>
            </div>
            <div className="max-h-[460px] overflow-y-auto p-2">
              <button
                onClick={() => setActiveClusterId(null)}
                className={cn(
                  "relative mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition-colors",
                  !activeClusterId ? "bg-primary/12 text-foreground" : "text-foreground/80 hover:bg-white/[0.04]",
                )}
              >
                {!activeClusterId && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />}
                <span className="font-medium">All keywords</span>
                <span className="text-xs text-muted-foreground">{keywords.length}</span>
              </button>
              {clusters.map((cluster) => {
                const isSel = cluster.id === activeClusterId;
                return (
                  <button
                    key={cluster.id}
                    onClick={() => setActiveClusterId((prev) => (prev === cluster.id ? null : cluster.id))}
                    className={cn(
                      "relative mb-1 flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-colors",
                      isSel ? "bg-primary/12" : "hover:bg-white/[0.04]",
                    )}
                  >
                    {isSel && <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />}
                    <span className={cn("line-clamp-1 text-sm font-medium", isSel ? "text-foreground" : "text-foreground/85")}>{cluster.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {cluster.keyword_count} kw · {(cluster.total_volume ?? 0).toLocaleString()} vol
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Table pane */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="font-display text-lg font-bold tracking-tight">
                  {activeCluster ? activeCluster.name : "All keywords"}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {filteredCount.toLocaleString()} keyword{filteredCount !== 1 ? "s" : ""}
                  {activeCluster?.topic ? ` · ${activeCluster.topic}` : ""}
                </p>
              </div>
              {activeClusterId && (
                <button
                  onClick={() => setActiveClusterId(null)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                  Clear filter
                </button>
              )}
            </div>
            <KeywordsTable keywords={keywords} activeClusterId={activeClusterId} />
          </div>
        </div>
      )}
    </div>
  );
}
