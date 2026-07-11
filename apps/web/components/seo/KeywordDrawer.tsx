"use client";

import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { X } from "lucide-react";
import { getKeywordHistory } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

const TOOLTIP_STYLE = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 12,
} as const;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface KeywordDrawerProps {
  keywordId: string;
  domain?: string | null;
  onClose: () => void;
}

export function KeywordDrawer({ keywordId, domain, onClose }: KeywordDrawerProps) {
  const { t } = useTranslation();

  const { data, isLoading } = useQuery({
    queryKey: ["seo-history", keywordId],
    queryFn: () => getKeywordHistory(keywordId, 90),
    staleTime: 60_000,
  });

  const chartData = (data?.points ?? []).map((p) => ({ date: fmtDate(p.date), position: p.position }));

  return (
    <Card className="flex h-full flex-col gap-4 p-4 animate-slide-up">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-foreground">{data?.keyword ?? "…"}</p>
          {data?.url && (
            <p className="truncate text-xs text-muted-foreground">{data.url.replace(/^https?:\/\/[^/]+/, "") || data.url}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {isLoading ? (
        <div className="h-40 animate-pulse rounded-xl bg-muted/30" />
      ) : (
        <>
          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              90d
            </p>
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  {/* Reversed: lower position number = better = visually up */}
                  <YAxis
                    reversed
                    domain={[1, "auto"]}
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Line
                    type="monotone"
                    dataKey="position"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-xs text-muted-foreground">{t("seoHub.empty")}</p>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t("seoHub.drawer.top10")}
            </p>
            <div className="flex flex-col gap-1">
              {(data?.top10 ?? []).map((entry) => {
                const isYou = !!domain && entry.domain.replace(/^www\./, "") === domain.replace(/^www\./, "");
                return (
                  <a
                    key={entry.rank}
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 transition-colors hover:bg-accent",
                      isYou && "bg-primary/10 border-primary/30",
                    )}
                  >
                    <span className="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                      {entry.rank}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{entry.title || entry.domain}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{entry.domain}</p>
                    </div>
                    {isYou && (
                      <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
                        {t("seoHub.drawer.you")}
                      </span>
                    )}
                  </a>
                );
              })}
              {(data?.top10 ?? []).length === 0 && (
                <p className="py-2 text-center text-xs text-muted-foreground">{t("seoHub.empty")}</p>
              )}
            </div>
          </div>

          {data && data.features.length > 0 && (
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("seoHub.columns.features")}
              </p>
              <div className="flex flex-wrap gap-1">
                {data.features.map((f) => (
                  <span key={f} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
