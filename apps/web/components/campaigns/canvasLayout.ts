import type { CampaignStep } from "@/lib/api";
import { CONTEXT_ACTIONS } from "@/lib/campaignMeta";

export interface LayoutNode {
  id: string;
  kind: "goal" | "step" | "package";
  step?: CampaignStep;
  x: number;
  y: number;
}
export interface LayoutEdge {
  x1: number; y1: number; x2: number; y2: number;
  fromStepId: string | null;
  toStepId: string | null;
}
export interface CanvasLayout { nodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number; }

export const NODE_W = 148;
export const NODE_H = 92;
const COL_GAP = 210;
const LANE_H = 128;
const PAD_X = 24;
const PAD_Y = 24;
const LANES = 3; // 0 top, 1 center, 2 bottom

/** Deterministic left-to-right layout: goal -> steps by order -> package.
 *  Context actions alternate top/bottom lanes; artifact actions sit center,
 *  so the sequential chain reads as a fan-in pipeline. */
export function computeLayout(steps: CampaignStep[]): CanvasLayout {
  const ordered = [...steps].sort((a, b) => a.order - b.order);
  const nodes: LayoutNode[] = [];
  const centerY = PAD_Y + 1 * LANE_H;

  nodes.push({ id: "goal", kind: "goal", x: PAD_X, y: centerY });

  let contextFlip = 0;
  ordered.forEach((step, i) => {
    const lane = CONTEXT_ACTIONS.has(step.action) ? (contextFlip++ % 2 === 0 ? 0 : 2) : 1;
    nodes.push({
      id: step.id,
      kind: "step",
      step,
      x: PAD_X + (i + 1) * COL_GAP,
      y: PAD_Y + lane * LANE_H,
    });
  });

  const packageX = PAD_X + (ordered.length + 1) * COL_GAP;
  nodes.push({ id: "package", kind: "package", x: packageX, y: centerY });

  const edges: LayoutEdge[] = [];
  const at = (id: string) => nodes.find((n) => n.id === id)!;
  const chain = ["goal", ...ordered.map((s) => s.id), "package"];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = at(chain[i]);
    const b = at(chain[i + 1]);
    edges.push({
      x1: a.x + NODE_W, y1: a.y + NODE_H / 2,
      x2: b.x, y2: b.y + NODE_H / 2,
      fromStepId: a.kind === "step" ? a.id : null,
      toStepId: b.kind === "step" ? b.id : null,
    });
  }

  return {
    nodes,
    edges,
    width: packageX + NODE_W + PAD_X,
    height: PAD_Y * 2 + LANES * LANE_H,
  };
}

export function edgePath(e: LayoutEdge): string {
  const mx = (e.x1 + e.x2) / 2;
  return `M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`;
}
