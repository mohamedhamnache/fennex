"use client";

import { type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Radar, Check, X, TrendingUp, TrendingDown, Minus, Clock } from "lucide-react";
import { listRecommendations, updateRecommendation, type Recommendation } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";

const VERDICT = {
  won: { label: "Won", cls: "bg-success/12 text-success", Icon: TrendingUp },
  flat: { label: "Flat", cls: "bg-muted text-muted-foreground", Icon: Minus },
  declined: { label: "Declined", cls: "bg-destructive/12 text-destructive", Icon: TrendingDown },
} as const;

export default function TrackingPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const qc = useQueryClient();
  const { success } = useToast();
  const { data = [], isLoading } = useQuery({
    queryKey: ["recommendations", projectId],
    queryFn: () => listRecommendations(projectId),
    staleTime: 30_000,
  });

  async function setStatus(id: string, status: "done" | "dismissed") {
    await updateRecommendation(id, status);
    qc.invalidateQueries({ queryKey: ["recommendations", projectId] });
    success(status === "done" ? "Marked done" : "Dismissed");
  }

  const needsConfirm = data.filter((r) => r.status === "tracking" && r.detected_content?.length);
  const inProgress = data.filter((r) => r.status === "tracking" && !r.detected_content?.length);
  const measuring = data.filter((r) => r.status === "done" && r.outcome === "pending");
  const results = data.filter((r) => r.status === "done" && r.outcome && r.outcome !== "pending");

  if (isLoading) return <div className="h-64 animate-pulse rounded-xl border bg-muted/30" />;

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/12 text-primary">
          <Radar className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h1 className="text-lg font-bold text-foreground leading-tight">Zerda · Tracked recommendations</h1>
          <p className="text-xs text-muted-foreground leading-tight">
            What Zerda suggested, what you acted on, and whether it worked — from your real search data
          </p>
        </div>
      </div>

      <Lane title="Needs confirmation" hint="Looks done — confirm to start measuring">
        {needsConfirm.map((r) => (
          <RecCard key={r.id} r={r}>
            <button onClick={() => setStatus(r.id, "done")} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
              <Check className="mr-1 inline h-3 w-3" /> Confirm done
            </button>
          </RecCard>
        ))}
      </Lane>

      <Lane title="In progress" hint="Accepted, not yet acted on">
        {inProgress.map((r) => (
          <RecCard key={r.id} r={r}>
            <button onClick={() => setStatus(r.id, "done")} className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent">Mark done</button>
            <button onClick={() => setStatus(r.id, "dismissed")} className="rounded-lg border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent"><X className="h-3 w-3" /></button>
          </RecCard>
        ))}
      </Lane>

      <Lane title="Measuring" hint="Acted on — measuring impact over 28 days">
        {measuring.map((r) => (
          <RecCard key={r.id} r={r}>
            <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" /> measuring</span>
          </RecCard>
        ))}
      </Lane>

      <Lane title="Results" hint="Measured impact">
        {results.map((r) => {
          const v = VERDICT[r.outcome as keyof typeof VERDICT];
          return (
            <RecCard key={r.id} r={r}>
              <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${v.cls}`}>
                <v.Icon className="h-3 w-3" /> {v.label}
              </span>
              {r.baseline && r.latest && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {r.baseline.clicks} → {r.latest.clicks} clicks
                </span>
              )}
            </RecCard>
          );
        })}
      </Lane>
    </div>
  );
}

function Lane({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  const empty = items.filter(Boolean).length === 0;
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs text-muted-foreground">— {hint}</span>
      </div>
      {empty ? <p className="text-xs text-muted-foreground">Nothing here yet.</p> : <div className="flex flex-col gap-2">{children}</div>}
    </div>
  );
}

function RecCard({ r, children }: { r: Recommendation; children: ReactNode }) {
  return (
    <Card className="flex flex-wrap items-center gap-3 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{r.title}</p>
        <p className="text-[11px] text-muted-foreground">
          {r.source_agent ? r.source_agent : r.source}{r.anchor_query ? ` · ${r.anchor_query}` : ""}
        </p>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </Card>
  );
}
