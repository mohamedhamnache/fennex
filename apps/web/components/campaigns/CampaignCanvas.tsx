"use client";

import { useMemo } from "react";
import type { Campaign } from "@/lib/api";
import { computeLayout, edgePath } from "./canvasLayout";
import { CanvasNode } from "./CanvasNode";
import { cn } from "@/lib/cn";

interface CampaignCanvasProps {
  campaign: Campaign;
  activeStepId: string | null;
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
}

export function CampaignCanvas({ campaign, activeStepId, selectedStepId, onSelectStep }: CampaignCanvasProps) {
  const layout = useMemo(() => computeLayout(campaign.steps), [campaign.steps]);
  const mode = campaign.status === "planned" ? "plan" : campaign.status === "running" ? "run" : "package";
  const byId = useMemo(() => new Map(campaign.steps.map((s) => [s.id, s])), [campaign.steps]);
  const done = campaign.steps.filter((s) => s.status === "completed" && s.artifact_type).length;
  const total = campaign.steps.length;

  return (
    <div className="canvas-grid overflow-x-auto rounded-2xl border border-border">
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        <svg className="absolute inset-0" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.edges.map((e, i) => {
            const from = e.fromStepId ? byId.get(e.fromStepId) : null;
            const to = e.toStepId ? byId.get(e.toStepId) : null;
            // An edge reads "done" once flow has traversed it: source step completed, or
            // (for the goal edge) the target step has left pending.
            const doneEdge = from ? from.status === "completed" : to ? to.status !== "pending" : mode !== "plan";
            const activeEdge = mode === "run" && to && to.id === activeStepId;
            return (
              <path
                key={i}
                d={edgePath(e)}
                fill="none"
                strokeWidth={activeEdge ? 2.5 : 2}
                className={cn(activeEdge && "edge-flow")}
                stroke={activeEdge ? "hsl(var(--primary))" : doneEdge && mode !== "plan" ? "hsl(var(--success) / 0.7)" : "hsl(var(--border))"}
                strokeDasharray={activeEdge ? "6 5" : mode === "plan" ? "0" : to && to.status === "pending" ? "4 4" : "0"}
              />
            );
          })}
        </svg>
        {layout.nodes.map((n) => (
          <CanvasNode
            key={n.id}
            kind={n.kind}
            x={n.x}
            y={n.y}
            step={n.step}
            goal={campaign.goal}
            packageInfo={n.kind === "package" ? { done, total } : undefined}
            mode={mode}
            active={n.id === activeStepId}
            selected={n.id === selectedStepId}
            onClick={n.kind === "step" ? () => onSelectStep(n.id === selectedStepId ? null : n.id) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
