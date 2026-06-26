"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
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

function IntentBadge({ intent }: { intent: Keyword["intent"] }) {
  if (!intent) return <span className="text-muted-foreground">—</span>;

  const styles: Record<NonNullable<Keyword["intent"]>, string> = {
    informational: "bg-blue-50 text-blue-600",
    navigational: "bg-violet-50 text-violet-600",
    commercial: "bg-amber-50 text-amber-600",
    transactional: "bg-emerald-50 text-emerald-600",
  };

  return (
    <span className={`badge ${styles[intent]}`}>
      {intent.charAt(0).toUpperCase() + intent.slice(1)}
    </span>
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
                    {kw.is_seed && (
                      <span className="badge bg-indigo-50 text-indigo-600">Seed</span>
                    )}
                  </span>
                </td>
                <td className="px-5 py-3 tabular-nums text-muted-foreground">
                  {kw.search_volume !== null
                    ? kw.search_volume.toLocaleString()
                    : "—"}
                </td>
                <td className="px-5 py-3">
                  <DifficultyBar score={kw.difficulty} />
                </td>
                <td className="px-5 py-3 tabular-nums text-muted-foreground">
                  {kw.cpc !== null ? `$${kw.cpc.toFixed(2)}` : "—"}
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
              {cluster.total_volume.toLocaleString()} total vol
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

  const [activeTab, setActiveTab] = useState<"keywords" | "clusters">("keywords");
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

  function handleClusterClick(id: string) {
    // Toggle: click same cluster deselects it; also switch to keywords tab to show filter
    setActiveClusterId((prev) => (prev === id ? null : id));
    setActiveTab("keywords");
  }

  const seedKeyword = jobQuery.data?.seed_keyword ?? seedInput.trim();

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Keywords</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Discover high-ROI opportunities
          </p>
        </div>
      </div>

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
        <div className="card-base p-4 border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800/30">
          <p className="text-sm text-red-600 dark:text-red-400">{submitError}</p>
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
        <div className="card-base p-5 flex items-start gap-3 border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800/30">
          <div>
            <p className="text-sm font-semibold text-red-600 dark:text-red-400">Research failed</p>
            <p className="mt-0.5 text-xs text-red-500/80 dark:text-red-400/70">
              {jobQuery.data?.error ?? "An unexpected error occurred. Please try again."}
            </p>
          </div>
        </div>
      )}

      {/* ── Done state ── */}
      {isDone && (
        <>
          {/* Stats strip */}
          <p className="text-xs text-muted-foreground">
            {keywords.length.toLocaleString()} keywords found &bull; {clusters.length} clusters
          </p>

          {/* Tab bar */}
          <div className="flex gap-1 border-b border-border">
            {(["keywords", "clusters"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === tab
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "keywords" ? "Keywords" : "Clusters"}
                {tab === "keywords" && activeClusterId && (
                  <span className="ml-1.5 badge bg-primary/10 text-primary text-[10px]">
                    Filtered
                  </span>
                )}
              </button>
            ))}
            {activeClusterId && (
              <button
                onClick={() => setActiveClusterId(null)}
                className="ml-auto px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear filter
              </button>
            )}
          </div>

          {/* Keywords tab */}
          {activeTab === "keywords" && (
            <KeywordsTable keywords={keywords} activeClusterId={activeClusterId} />
          )}

          {/* Clusters tab */}
          {activeTab === "clusters" && (
            <ClustersGrid
              clusters={clusters}
              activeClusterId={activeClusterId}
              onClusterClick={handleClusterClick}
            />
          )}
        </>
      )}
    </div>
  );
}
