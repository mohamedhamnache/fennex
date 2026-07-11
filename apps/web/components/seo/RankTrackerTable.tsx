"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";
import { ArrowUp, ArrowDown, ExternalLink, RefreshCw, Trash2, Loader2 } from "lucide-react";
import {
  listTrackedKeywords,
  removeTrackedKeyword,
  refreshTrackedKeyword,
  ApiError,
  type TrackedKeywordRow,
} from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

function DeltaChip({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  if (value === 0) return <span className="text-muted-foreground">—</span>;
  // delta is (previous - current); positive means position improved (moved up).
  const improved = value > 0;
  return (
    <span className={cn("flex items-center justify-end gap-0.5 text-xs font-semibold", improved ? "text-success" : "text-destructive")}>
      {improved ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(value).toFixed(1)}
    </span>
  );
}

function RowSparkline({ spark }: { spark: TrackedKeywordRow["spark"] }) {
  const data = spark.filter((p) => p.position !== null);
  if (data.length < 2) {
    return <div className="h-7 w-20" aria-hidden />;
  }
  return (
    <div className="h-7 w-20">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          {/* Reversed: lower position number = better = visually higher */}
          <YAxis dataKey="position" hide reversed domain={["dataMin - 1", "dataMax + 1"]} />
          <Line type="monotone" dataKey="position" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function FeatureBadges({ features }: { features: string[] }) {
  if (features.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {features.map((f) => (
        <span key={f} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          {f}
        </span>
      ))}
    </div>
  );
}

interface RankTrackerTableProps {
  projectId: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onGateHit: () => void;
}

export function RankTrackerTable({ projectId, selectedId, onSelect, onGateHit }: RankTrackerTableProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { error: showError, success: showSuccess } = useToast();
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["seo-keywords", projectId],
    queryFn: () => listTrackedKeywords(projectId),
    staleTime: 60_000,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeTrackedKeyword(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["seo-keywords", projectId] });
    },
    onError: () => {
      showError(t("seoHub.remove"), { message: t("common.error") });
    },
  });

  async function handleRefresh(id: string) {
    setRefreshingId(id);
    try {
      await refreshTrackedKeyword(id);
      queryClient.invalidateQueries({ queryKey: ["seo-keywords", projectId] });
      queryClient.invalidateQueries({ queryKey: ["seo-history", id] });
      showSuccess(t("seoHub.refresh"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        onGateHit();
      } else {
        showError(t("seoHub.refresh"), { message: t("common.error") });
      }
    } finally {
      setRefreshingId(null);
    }
  }

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-xl border bg-muted/30" />;
  }

  if (rows.length === 0) {
    return (
      <Card className="p-10 text-center">
        <p className="text-sm text-muted-foreground">{t("seoHub.empty")}</p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t("seoHub.columns.keyword")}</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">{t("seoHub.columns.position")}</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">{t("seoHub.columns.delta7")}</th>
            <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">{t("seoHub.columns.delta30")}</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t("seoHub.columns.url")}</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t("seoHub.columns.features")}</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">{t("seoHub.columns.checked")}</th>
            <th className="px-4 py-2.5 font-medium text-muted-foreground" />
            <th className="px-4 py-2.5 font-medium text-muted-foreground" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onSelect(row.id)}
              className={cn(
                "cursor-pointer border-b transition-colors last:border-0 hover:bg-muted/20",
                selectedId === row.id && "bg-primary/10",
              )}
            >
              <td className="px-4 py-3 font-medium text-foreground">{row.keyword}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {row.position === null ? (
                  <span className="text-xs text-muted-foreground">{t("seoHub.notRanked")}</span>
                ) : (
                  row.position
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <DeltaChip value={row.delta_7d} />
              </td>
              <td className="px-4 py-3 text-right">
                <DeltaChip value={row.delta_30d} />
              </td>
              <td className="px-4 py-3 max-w-[220px]">
                {row.url ? (
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink className="h-3 w-3 shrink-0" />
                    <span className="truncate">{row.url.replace(/^https?:\/\/[^/]+/, "") || row.url}</span>
                  </a>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <FeatureBadges features={row.features} />
              </td>
              <td className="px-4 py-3 text-xs text-muted-foreground">
                {row.last_checked ? new Date(row.last_checked).toLocaleDateString() : "—"}
              </td>
              <td className="px-2 py-3">
                <RowSparkline spark={row.spark} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRefresh(row.id);
                    }}
                    disabled={refreshingId === row.id}
                    title={t("seoHub.refresh")}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    {refreshingId === row.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeMutation.mutate(row.id);
                    }}
                    disabled={removeMutation.isPending}
                    title={t("seoHub.remove")}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
