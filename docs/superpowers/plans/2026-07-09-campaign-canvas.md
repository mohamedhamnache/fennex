# Campaign Canvas (Campaigns UX Redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain campaigns page with a theme-aware pipeline-canvas experience (plan / run / package modes) plus four differentiators: cost+time estimates, Ship to Calendar, Zerda auto-tracking, persona templates.

**Architecture:** Frontend-heavy: a deterministic layout function positions goal/step/package nodes over an SVG bezier edge layer; mode styling driven by `campaign.status`. The page decomposes into `components/campaigns/*` + `lib/campaignMeta.ts`. One small backend change: an auto-track hook in `execute_campaign` that creates a Zerda `Recommendation` from the campaign's angle keyword on completion.

**Tech Stack:** Next.js 14 App Router, TypeScript, TanStack Query, Tailwind (CSS variables, `dark:` variants), react-i18next, SVG + CSS keyframes (no new deps); FastAPI + pytest for the hook.

Spec: `docs/superpowers/specs/2026-07-09-campaign-canvas-design.md`
Branch: continue on `feat/orchestrated-campaigns`.

## Global Constraints

- **NO EMOJI** anywhere (code, UI, comments, commit messages).
- **No new dependencies** (no graph/flow libraries).
- Frontend: all API via `apiClient` functions already in `apps/web/lib/api.ts` (`createCampaign`, `listCampaigns`, `getCampaign`, `updateCampaignPlan`, `runCampaign`, `cancelCampaign`, `createCalendarEntry`, `getImage`, `listArticles`, `listProjects`); Tailwind CSS variables only (no hex in TSX); **full i18n** — every user-visible string via `t("campaigns.*")`, keys added to `apps/web/public/locales/en/common.json` (other locales fall back to en). Verify with `cd apps/web && npm run typecheck` (exit 0). Dev server: port 3001.
- **i18n action-label keys use underscores** (i18next treats `.` as a nesting separator): key = `action.replace(/\./g, "_")` → `campaigns.canvas.actions.dune_write_article`.
- All new animations must be disabled under `@media (prefers-reduced-motion: reduce)`.
- Theme-aware: light "Light Studio" / dark "Dark Observatory" via Tailwind `dark:` variants and a `.canvas-grid` CSS class with a `.dark` override.
- Backend tests inside docker from repo root: `docker compose exec -T api pytest tests/test_campaigns.py -v`. Commit style `feat(campaigns): ...`.
- Campaign statuses: `planned|running|completed|failed|cancelled`; step statuses: `pending|running|completed|failed|skipped`. Context actions: `oasis.market_report`, `zerda.pick_angle`, `sable.competitor_scan`; artifact actions: `dune.write_article`, `sirocco.generate_visual`, `nomad.social_posts`.

---

## PHASE A — Canvas core

### Task 1: `campaignMeta.ts` + all new i18n keys

**Files:**
- Create: `apps/web/lib/campaignMeta.ts`
- Modify: `apps/web/public/locales/en/common.json` (extend the existing `campaigns` block)

**Interfaces:**
- Produces: `AGENT_VISUALS: Record<string, {name: string; Icon: LucideIcon; gradient: string}>`; `ACTION_ESTIMATES: Record<string, ActionEstimate>`; `estimateFor(action) -> ActionEstimate` (safe fallback); `sumEstimates(actions: string[]) -> ActionEstimate`; `fmtEstimate(e, t) -> string`; `actionLabelKey(action) -> string`; `CAMPAIGN_TEMPLATES: {key: string; personas: string[]}[]`; `CONTEXT_ACTIONS: Set<string>`.

- [ ] **Step 1: Create `apps/web/lib/campaignMeta.ts`:**
```typescript
import { Radar, Wind, ScrollText, Wand2, Footprints, Palmtree, Compass, Sparkles, type LucideIcon } from "lucide-react";

export interface ActionEstimate {
  costMin: number;
  costMax: number;
  minMinutes: number;
  maxMinutes: number;
}

/** Static, honest estimates per catalog action (labeled "estimated" in the UI). */
export const ACTION_ESTIMATES: Record<string, ActionEstimate> = {
  "oasis.market_report": { costMin: 0.02, costMax: 0.06, minMinutes: 1, maxMinutes: 2 },
  "zerda.pick_angle": { costMin: 0.01, costMax: 0.03, minMinutes: 1, maxMinutes: 1 },
  "sable.competitor_scan": { costMin: 0.01, costMax: 0.04, minMinutes: 1, maxMinutes: 2 },
  "dune.write_article": { costMin: 0.15, costMax: 0.35, minMinutes: 2, maxMinutes: 4 },
  "sirocco.generate_visual": { costMin: 0.04, costMax: 0.08, minMinutes: 1, maxMinutes: 2 },
  "nomad.social_posts": { costMin: 0.03, costMax: 0.08, minMinutes: 1, maxMinutes: 2 },
};

const FALLBACK_ESTIMATE: ActionEstimate = { costMin: 0.01, costMax: 0.1, minMinutes: 1, maxMinutes: 3 };

export function estimateFor(action: string): ActionEstimate {
  return ACTION_ESTIMATES[action] ?? FALLBACK_ESTIMATE;
}

export function sumEstimates(actions: string[]): ActionEstimate {
  return actions.reduce(
    (acc, a) => {
      const e = estimateFor(a);
      return {
        costMin: acc.costMin + e.costMin,
        costMax: acc.costMax + e.costMax,
        minMinutes: acc.minMinutes + e.minMinutes,
        maxMinutes: acc.maxMinutes + e.maxMinutes,
      };
    },
    { costMin: 0, costMax: 0, minMinutes: 0, maxMinutes: 0 },
  );
}

/** "~$0.15-0.35 / 2-4 min" — t() supplies the localized "min" unit. */
export function fmtEstimate(e: ActionEstimate, minUnit: string): string {
  const cost = `~$${e.costMin.toFixed(2)}-${e.costMax.toFixed(2)}`;
  const mins = e.minMinutes === e.maxMinutes ? `${e.maxMinutes}` : `${e.minMinutes}-${e.maxMinutes}`;
  return `${cost} / ${mins} ${minUnit}`;
}

/** i18next uses "." as a nesting separator, so action label keys use "_". */
export function actionLabelKey(action: string): string {
  return `campaigns.canvas.actions.${action.replace(/\./g, "_")}`;
}

export const CONTEXT_ACTIONS = new Set(["oasis.market_report", "zerda.pick_angle", "sable.competitor_scan"]);

/** Per-agent visuals for canvas nodes (gradients use Tailwind utility classes). */
export const AGENT_VISUALS: Record<string, { name: string; Icon: LucideIcon; gradient: string }> = {
  zerda: { name: "Zerda", Icon: Radar, gradient: "from-indigo-500 to-violet-500" },
  sirocco: { name: "Sirocco", Icon: Wind, gradient: "from-violet-500 to-fuchsia-500" },
  dune: { name: "Dune", Icon: ScrollText, gradient: "from-blue-500 to-indigo-500" },
  mirage: { name: "Mirage", Icon: Wand2, gradient: "from-fuchsia-500 to-pink-500" },
  sable: { name: "Sable", Icon: Footprints, gradient: "from-slate-600 to-indigo-600" },
  oasis: { name: "Oasis", Icon: Palmtree, gradient: "from-emerald-500 to-teal-500" },
  nomad: { name: "Nomad", Icon: Compass, gradient: "from-amber-500 to-orange-500" },
};

export function agentVisual(agent: string): { name: string; Icon: LucideIcon; gradient: string } {
  return AGENT_VISUALS[agent] ?? { name: agent, Icon: Sparkles, gradient: "from-primary to-primary" };
}

/** Persona quick-start templates; label/goal text lives in i18n under campaigns.templates.<key>. */
export const CAMPAIGN_TEMPLATES: { key: string; personas: string[] }[] = [
  { key: "audience_growth", personas: ["creator"] },
  { key: "series_week", personas: ["creator"] },
  { key: "collab_push", personas: ["creator"] },
  { key: "product_launch", personas: ["ecommerce"] },
  { key: "buyer_guide", personas: ["ecommerce"] },
  { key: "store_traffic", personas: ["ecommerce"] },
  { key: "launch_offer", personas: ["freelancer"] },
  { key: "own_topic", personas: ["freelancer"] },
  { key: "seasonal_push", personas: ["freelancer"] },
];
```

- [ ] **Step 2: Extend the `campaigns` i18n block** in `apps/web/public/locales/en/common.json` — merge these keys INTO the existing `campaigns` object (do not remove existing keys):
```json
"canvas": {
  "goal": "Goal",
  "package": "Package",
  "packagePending": "{{done}} / {{total}} artifacts",
  "launch": "Launch campaign",
  "estimatedTotal": "Estimated total",
  "minutes": "min",
  "directorNote": "Sirocco's plan",
  "elapsed": "Elapsed",
  "liveFeed": "Live feed",
  "stepsDone": "{{done}} of {{total}} steps",
  "actions": {
    "oasis_market_report": "Market report",
    "zerda_pick_angle": "Pick the angle",
    "sable_competitor_scan": "Competitor scan",
    "dune_write_article": "Write the article",
    "sirocco_generate_visual": "Generate the visual",
    "nomad_social_posts": "Social posts"
  }
},
"stepPanel": {
  "brief": "Brief",
  "noBrief": "No parameters",
  "errorLabel": "Error",
  "removeStep": "Remove step",
  "estimateLabel": "Estimated"
},
"ship": {
  "ship": "Ship to Calendar",
  "shipped": "Scheduled - view calendar",
  "shipFailed": "Could not schedule. Try again."
},
"trackingChip": {
  "title": "Zerda is tracking this campaign",
  "body": "Targeting \"{{keyword}}\". Zerda will measure the real impact for 28 days after you publish and report whether it worked.",
  "view": "View tracking"
},
"composer": {
  "headline": "What should the Pack achieve?",
  "subline": "One goal in. Research, strategy, content, visuals and distribution out.",
  "cta": "Design my campaign",
  "templatesHint": "Templates tuned to your persona",
  "past": "Your campaigns",
  "runAgain": "Run again",
  "openArticle": "Open",
  "reviewSocial": "Review in Social",
  "wordCount": "{{count}} words",
  "seoScore": "SEO {{score}}"
},
"templates": {
  "audience_growth": { "label": "Grow my audience", "goal": "Grow my audience this month with content on the topics my readers already search for" },
  "series_week": { "label": "A week-long series", "goal": "Create a one-week content series that owns one high-demand topic in my niche" },
  "collab_push": { "label": "Collab announcement", "goal": "Announce and promote my new collaboration with an article, a visual and a social series" },
  "product_launch": { "label": "Launch a product", "goal": "Launch my new product with a landing article, a hero visual and a social campaign" },
  "buyer_guide": { "label": "Buyer's guide", "goal": "Publish a buyer's guide that captures the commercial searches in my category" },
  "store_traffic": { "label": "Drive store traffic", "goal": "Drive more organic traffic to my store with content on my highest-potential keywords" },
  "launch_offer": { "label": "Launch a new offer", "goal": "Launch my new service offer and attract qualified leads this quarter" },
  "own_topic": { "label": "Own a topic in my niche", "goal": "Become the reference on one topic my potential clients search for" },
  "seasonal_push": { "label": "Seasonal content push", "goal": "Prepare a seasonal campaign that captures the upcoming peak in my niche" }
}
```

- [ ] **Step 3: Validate + typecheck**

Run: `python3 -c "import json; json.load(open('apps/web/public/locales/en/common.json')); print('valid')"` then `cd apps/web && npm run typecheck`
Expected: `valid`, exit 0.

- [ ] **Step 4: Commit**
```bash
git add apps/web/lib/campaignMeta.ts apps/web/public/locales/en/common.json
git commit -m "feat(campaigns): campaign meta (visuals, estimates, templates) + canvas i18n keys"
```

---

### Task 2: Canvas layout + `CanvasNode` + `CampaignCanvas` + CSS keyframes

**Files:**
- Create: `apps/web/components/campaigns/canvasLayout.ts`
- Create: `apps/web/components/campaigns/CanvasNode.tsx`
- Create: `apps/web/components/campaigns/CampaignCanvas.tsx`
- Modify: `apps/web/app/globals.css` (append keyframes + `.canvas-grid`)

**Interfaces:**
- Consumes: `CampaignStep`, `Campaign` (from `@/lib/api`); `agentVisual`, `estimateFor`, `fmtEstimate`, `actionLabelKey`, `CONTEXT_ACTIONS` (Task 1).
- Produces:
  - `computeLayout(steps: CampaignStep[]) -> CanvasLayout` where `CanvasLayout = { nodes: LayoutNode[]; edges: LayoutEdge[]; width: number; height: number }`, `LayoutNode = { id: string; kind: "goal" | "step" | "package"; step?: CampaignStep; x: number; y: number }`, `LayoutEdge = { x1: number; y1: number; x2: number; y2: number; fromStepId: string | null; toStepId: string | null }`.
  - `<CampaignCanvas campaign={Campaign} activeStepId={string|null} selectedStepId={string|null} onSelectStep={(id)=>void} />`.

- [ ] **Step 1: Append canvas CSS to `apps/web/app/globals.css`** (after the existing keyframes section):
```css
/* -- Campaign Canvas ------------------------------------------------------ */
.canvas-grid {
  background-color: hsl(var(--background));
  background-image: radial-gradient(hsl(var(--foreground) / 0.07) 1px, transparent 1px);
  background-size: 22px 22px;
}
.dark .canvas-grid {
  background-color: hsl(224 56% 5%);
  background-image:
    radial-gradient(700px 260px at 25% -10%, hsl(var(--primary) / 0.14), transparent 60%),
    radial-gradient(hsl(var(--foreground) / 0.08) 1px, transparent 1px);
  background-size: auto, 22px 22px;
}
@keyframes edgeFlow { to { stroke-dashoffset: -22; } }
.edge-flow { animation: edgeFlow 1.1s linear infinite; }
@keyframes nodePulse {
  0%, 100% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.35); }
  50% { box-shadow: 0 0 0 12px hsl(var(--primary) / 0); }
}
.node-active { animation: nodePulse 1.8s ease-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .edge-flow, .node-active { animation: none; }
}
```

- [ ] **Step 2: Create `apps/web/components/campaigns/canvasLayout.ts`** (pure — no React):
```typescript
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
```

- [ ] **Step 3: Create `apps/web/components/campaigns/CanvasNode.tsx`:**
```tsx
"use client";

import { useTranslation } from "react-i18next";
import { Check, X, Target, Gift, SkipForward } from "lucide-react";
import type { CampaignStep } from "@/lib/api";
import { agentVisual, estimateFor, fmtEstimate, actionLabelKey } from "@/lib/campaignMeta";
import { NODE_W, NODE_H } from "./canvasLayout";
import { cn } from "@/lib/cn";

interface CanvasNodeProps {
  kind: "goal" | "step" | "package";
  x: number;
  y: number;
  step?: CampaignStep;
  goal?: string;
  packageInfo?: { done: number; total: number };
  mode: "plan" | "run" | "package";
  active?: boolean;
  selected?: boolean;
  onClick?: () => void;
}

export function CanvasNode({ kind, x, y, step, goal, packageInfo, mode, active, selected, onClick }: CanvasNodeProps) {
  const { t } = useTranslation();
  const base = "absolute rounded-2xl border text-left transition-all";
  const pos = { left: x, top: y, width: NODE_W, height: NODE_H } as const;

  if (kind === "goal") {
    return (
      <div style={pos} className={cn(base, "flex flex-col justify-center gap-1 border-primary/40 bg-foreground p-3 text-background dark:bg-card dark:text-foreground dark:border-primary/50")}>
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider opacity-70">
          <Target className="h-3 w-3" /> {t("campaigns.canvas.goal")}
        </span>
        <span className="line-clamp-2 text-xs font-semibold leading-snug">{goal}</span>
      </div>
    );
  }

  if (kind === "package") {
    return (
      <div style={pos} className={cn(base, "flex flex-col items-center justify-center gap-1 border-dashed border-border bg-card/60 p-3", mode === "package" && "border-solid border-success/60 bg-success/5")}>
        <Gift className={cn("h-4 w-4", mode === "package" ? "text-success" : "text-muted-foreground")} strokeWidth={1.8} />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("campaigns.canvas.package")}</span>
        {packageInfo && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {t("campaigns.canvas.packagePending", { done: packageInfo.done, total: packageInfo.total })}
          </span>
        )}
      </div>
    );
  }

  const s = step!;
  const visual = agentVisual(s.agent);
  const stateClass =
    s.status === "completed" ? "border-success/70" :
    s.status === "failed" ? "border-destructive/70" :
    s.status === "skipped" ? "border-border border-dashed opacity-60" :
    active ? "border-primary node-active shadow-lg" :
    "border-border border-dashed";

  return (
    <button
      type="button"
      onClick={onClick}
      style={pos}
      className={cn(base, "bg-card p-2.5 hover:border-primary/50", stateClass, selected && "ring-2 ring-primary/40")}
    >
      <span className="flex items-center gap-2">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white", visual.gradient)}>
          <visual.Icon className="h-3.5 w-3.5" strokeWidth={2} />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-bold text-foreground">{visual.name}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{t(actionLabelKey(s.action))}</span>
        </span>
        {s.status === "completed" && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-success" strokeWidth={3} />}
        {s.status === "failed" && <X className="ml-auto h-3.5 w-3.5 shrink-0 text-destructive" strokeWidth={3} />}
        {s.status === "skipped" && <SkipForward className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      </span>
      <span className="mt-1.5 block truncate text-[10px] text-muted-foreground">
        {mode === "plan"
          ? fmtEstimate(estimateFor(s.action), t("campaigns.canvas.minutes"))
          : t(`campaigns.stepStatus.${s.status}`)}
      </span>
    </button>
  );
}
```

- [ ] **Step 4: Create `apps/web/components/campaigns/CampaignCanvas.tsx`:**
```tsx
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
            const doneEdge = (from === null || from?.status === "completed") &&
              (e.fromStepId !== null || campaign.status !== "planned");
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
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: exit 0. (These components are not yet imported by the page — that is Task 4.)

- [ ] **Step 6: Commit**
```bash
git add apps/web/components/campaigns/canvasLayout.ts apps/web/components/campaigns/CanvasNode.tsx apps/web/components/campaigns/CampaignCanvas.tsx apps/web/app/globals.css
git commit -m "feat(campaigns): pipeline canvas core (layout, nodes, edges, theme CSS)"
```

---

### Task 3: `StepPanel` + `LiveFeed`

**Files:**
- Create: `apps/web/components/campaigns/StepPanel.tsx`
- Create: `apps/web/components/campaigns/LiveFeed.tsx`

**Interfaces:**
- Consumes: `CampaignStep`, `Campaign`; `agentVisual`, `estimateFor`, `fmtEstimate`, `actionLabelKey` (Task 1).
- Produces:
  - `<StepPanel step campaign onClose={()=>void} onRemove={(stepId)=>void} removing={boolean} />` — Remove shown only when `campaign.status === "planned"`.
  - `<LiveFeed campaign onCancel={()=>void} cancelling={boolean} />`.

- [ ] **Step 1: Create `apps/web/components/campaigns/StepPanel.tsx`:**
```tsx
"use client";

import { useTranslation } from "react-i18next";
import { X, Trash2 } from "lucide-react";
import type { Campaign, CampaignStep } from "@/lib/api";
import { agentVisual, estimateFor, fmtEstimate, actionLabelKey } from "@/lib/campaignMeta";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

interface StepPanelProps {
  step: CampaignStep;
  campaign: Campaign;
  onClose: () => void;
  onRemove: (stepId: string) => void;
  removing: boolean;
}

export function StepPanel({ step, campaign, onClose, onRemove, removing }: StepPanelProps) {
  const { t } = useTranslation();
  const visual = agentVisual(step.agent);
  const brief = step.brief ?? {};
  const briefEntries = Object.entries(brief).filter(([, v]) => v !== null && v !== undefined && v !== "");

  return (
    <Card className="flex h-full flex-col gap-3 p-4 animate-slide-up">
      <div className="flex items-start gap-2.5">
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white", visual.gradient)}>
          <visual.Icon className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">{visual.name}</p>
          <p className="text-xs text-muted-foreground">{t(actionLabelKey(step.action))}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {step.why && <p className="text-xs italic leading-relaxed text-muted-foreground">&ldquo;{step.why}&rdquo;</p>}

      <div>
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("campaigns.stepPanel.brief")}</p>
        {briefEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("campaigns.stepPanel.noBrief")}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {briefEntries.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
                <span className="text-[10px] font-medium text-muted-foreground">{k}</span>
                <p className="truncate text-xs text-foreground">{String(v)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {t("campaigns.stepPanel.estimateLabel")}: {fmtEstimate(estimateFor(step.action), t("campaigns.canvas.minutes"))}
      </p>

      {step.summary && <p className="rounded-lg bg-muted/40 p-2.5 text-xs leading-relaxed text-foreground/90">{step.summary}</p>}
      {step.error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          {t("campaigns.stepPanel.errorLabel")}: {step.error}
        </p>
      )}

      {campaign.status === "planned" && (
        <button
          type="button"
          onClick={() => onRemove(step.id)}
          disabled={removing}
          className="mt-auto flex items-center justify-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-2 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> {t("campaigns.stepPanel.removeStep")}
        </button>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Create `apps/web/components/campaigns/LiveFeed.tsx`:**
```tsx
"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Campaign } from "@/lib/api";
import { agentVisual } from "@/lib/campaignMeta";
import { cn } from "@/lib/cn";

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function LiveFeed({ campaign, onCancel, cancelling }: { campaign: Campaign; onCancel: () => void; cancelling: boolean }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const started = campaign.steps
    .map((s) => (s as { started_at?: string | null }).started_at)
    .filter(Boolean)
    .sort()[0];
  const elapsed = started ? fmtElapsed(now - new Date(started as string).getTime()) : "--:--";
  const done = campaign.steps.filter((s) => s.status === "completed").length;
  const total = campaign.steps.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const feed = campaign.steps.filter((s) => s.status === "completed" && s.summary).slice(-3);

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card/80 p-3 backdrop-blur">
      <div className="flex items-center gap-3">
        <div className="relative h-10 w-10 shrink-0" role="img" aria-label={`${pct}%`}>
          <svg viewBox="0 0 36 36" className="h-10 w-10 -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--border))" strokeWidth="3.5" />
            <circle cx="18" cy="18" r="15" fill="none" stroke="hsl(var(--primary))" strokeWidth="3.5"
              strokeDasharray={`${(pct / 100) * 94.2} 94.2`} strokeLinecap="round" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold tabular-nums text-foreground">{pct}%</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-foreground">{t("campaigns.canvas.stepsDone", { done, total })}</p>
          <p className="text-[11px] tabular-nums text-muted-foreground">{t("campaigns.canvas.elapsed")} {elapsed}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={cancelling}
          className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          {t("campaigns.cancel")}
        </button>
      </div>
      {feed.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t("campaigns.canvas.liveFeed")}</p>
          {feed.map((s) => {
            const v = agentVisual(s.agent);
            return (
              <p key={s.id} className="truncate text-[11px] text-foreground/90 animate-msg-in">
                <span className={cn("bg-gradient-to-r bg-clip-text font-bold text-transparent", v.gradient)}>{v.name}</span>
                <span className="text-muted-foreground"> — {s.summary}</span>
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
}
```
Note: `CampaignStep` in `api.ts` may not declare `started_at` — check the interface; if absent, add `started_at?: string | null;` and `finished_at?: string | null;` to the `CampaignStep` interface in `apps/web/lib/api.ts` (the backend serializer does not currently emit them — see Task 4 note; the LiveFeed code above degrades to "--:--" when absent, which is acceptable).

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**
```bash
git add apps/web/components/campaigns/StepPanel.tsx apps/web/components/campaigns/LiveFeed.tsx apps/web/lib/api.ts
git commit -m "feat(campaigns): step side panel and live run feed"
```

---

### Task 4: Backend — serialize step timestamps; page rewrite (plan + run on canvas)

**Files:**
- Modify: `apps/api/app/api/v1/routers/campaigns.py` (`_step` serializer: add `started_at`/`finished_at`)
- Modify: `apps/web/lib/api.ts` (`CampaignStep`: add the two fields if not added in Task 3)
- Modify: `apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx` (rewrite)
- Test: `apps/api/tests/test_campaigns.py` (extend one endpoint assertion)

**Interfaces:**
- Consumes: `CampaignCanvas`, `StepPanel`, `LiveFeed` (Tasks 2-3); `sumEstimates`, `fmtEstimate` (Task 1); existing api client functions.
- Produces: the rewritten page (composer kept minimal; Package rendering keeps the existing `PackageLinkCard`/`PackageDetailCard` until Task 6).

- [ ] **Step 1: Backend — add timestamps to the step serializer.** In `apps/api/app/api/v1/routers/campaigns.py`, `_step()`: add `"started_at": s.started_at, "finished_at": s.finished_at,` to the returned dict. Extend the existing `test_create_campaign_persists_plan` assertion with `assert "started_at" in body["steps"][0]`. Run `docker compose exec -T api pytest tests/test_campaigns.py -v` → all pass.

- [ ] **Step 2: Frontend types.** In `apps/web/lib/api.ts`, ensure `CampaignStep` includes `started_at: string | null;` and `finished_at: string | null;` (add if Task 3 did not).

- [ ] **Step 3: Rewrite the page.** Replace the body of `apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx` so it becomes a thin orchestrator. Keep: all existing queries/mutations (`listCampaigns`, `getCampaign` with the stop-when-not-running `refetchInterval`, `createCampaign`, `updateCampaignPlan`, `runCampaign`, `cancelCampaign`), the existing `PackageLinkCard` + `PackageDetailCard` components (unchanged, still used for the package section until Task 6), the existing composer input JSX (unchanged until Task 7), and the existing i18n keys. New structure for the selected-campaign view:
```tsx
// inside the selected-campaign branch:
const activeStepId =
  activeCampaign.status === "running"
    ? (activeCampaign.steps.find((s) => s.status === "running") ??
       activeCampaign.steps.filter((s) => s.status === "pending").sort((a, b) => a.order - b.order)[0])?.id ?? null
    : null;

<div className="flex flex-col gap-4">
  {/* header: goal + status badge + back */}
  <div className="flex items-center gap-3">
    <button onClick={() => { setActiveCampaignId(null); setSelectedStepId(null); }} className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent">{t("campaigns.back")}</button>
    <div className="min-w-0 flex-1">
      <h2 className="truncate text-base font-bold text-foreground">{activeCampaign.goal}</h2>
      {activeCampaign.director_summary && activeCampaign.status === "planned" && (
        <p className="truncate text-xs text-muted-foreground">{t("campaigns.canvas.directorNote")}: {activeCampaign.director_summary}</p>
      )}
    </div>
    <span className={statusBadgeClass(activeCampaign.status)}>{t(`campaigns.status.${activeCampaign.status}`)}</span>
  </div>

  {/* canvas + optional side panel */}
  <div className="flex gap-4">
    <div className="min-w-0 flex-1">
      <CampaignCanvas campaign={activeCampaign} activeStepId={activeStepId} selectedStepId={selectedStepId} onSelectStep={setSelectedStepId} />
    </div>
    {selectedStep && (
      <div className="w-72 shrink-0">
        <StepPanel step={selectedStep} campaign={activeCampaign} onClose={() => setSelectedStepId(null)}
          onRemove={(id) => removeStepMutation.mutate(id)} removing={removeStepMutation.isPending} />
      </div>
    )}
  </div>

  {/* mode footer */}
  {activeCampaign.status === "planned" && (
    <div className="flex items-center justify-between rounded-2xl border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">
        {t("campaigns.canvas.estimatedTotal")}: <span className="font-semibold text-foreground">{fmtEstimate(sumEstimates(activeCampaign.steps.map((s) => s.action)), t("campaigns.canvas.minutes"))}</span>
        <span className="ml-2">{t("campaigns.canvas.stepsDone", { done: 0, total: activeCampaign.steps.length })}</span>
      </p>
      <button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}
        className="btn-primary px-5 py-2 text-sm">{t("campaigns.canvas.launch")}</button>
    </div>
  )}
  {activeCampaign.status === "running" && (
    <LiveFeed campaign={activeCampaign} onCancel={() => cancelMutation.mutate()} cancelling={cancelMutation.isPending} />
  )}
  {activeCampaign.status !== "planned" && activeCampaign.status !== "running" && (
    /* keep the existing package section (PackageLinkCard / PackageDetailCard grid) here unchanged */
  )}
</div>
```
Implementation details: `selectedStepId` is new `useState<string | null>`; `selectedStep = activeCampaign?.steps.find(s => s.id === selectedStepId) ?? null`; clear `selectedStepId` when the campaign changes; `statusBadgeClass` maps status → existing badge classes used today (completed → success tones, running → primary, failed → destructive, else muted). The remove mutation already exists (`updateCampaignPlan` with remaining ids) — reuse it, and also clear `selectedStepId` on success. Delete the old plan-step-cards list and old timeline JSX (replaced by canvas + panel + feed); keep everything else.

- [ ] **Step 4: Typecheck + restart + smoke**

Run: `cd apps/web && npm run typecheck` → exit 0. Then `docker compose restart web api && sleep 9 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/` → 200/302. Browser check: draft a campaign → canvas renders with estimates; click a node → panel opens; remove a step → canvas relayouts; Launch → run mode animates (active node pulse + edge flow); light AND dark mode; reduced-motion (OS setting or devtools emulation) disables animation.

- [ ] **Step 5: Commit**
```bash
git add apps/api/app/api/v1/routers/campaigns.py apps/api/tests/test_campaigns.py apps/web/lib/api.ts "apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx"
git commit -m "feat(campaigns): canvas-driven page for plan and run modes + step timestamps"
```

---

## PHASE B — Package, differentiators, composer

### Task 5: Backend — Zerda auto-track hook

**Files:**
- Modify: `apps/api/app/workers/tasks/campaign_tasks.py`
- Test: `apps/api/tests/test_campaigns.py` (append; add `"recommendations"` to `SQLITE_COMPATIBLE_TABLES` and import the model)

**Interfaces:**
- Consumes: `recommendation_service.create_recommendation(project_id, org_id, data: dict, db)`; `Recommendation` model.
- Produces: `async _autotrack_campaign(campaign, steps, db) -> None`, called after a campaign reaches `completed`.

- [ ] **Step 1: Write failing tests** — append to `tests/test_campaigns.py` (also add `"recommendations"` to `SQLITE_COMPATIBLE_TABLES` and `from app.models.recommendation import Recommendation  # noqa: F401` beside the other model imports):
```python
@pytest.mark.asyncio
async def test_completed_campaign_autotracks_angle(db_session, org_and_project):
    from app.services.campaign_catalog import StepResult
    from app.workers.tasks.campaign_tasks import execute_campaign
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="Win clients", persona="freelancer", status="running")
    db_session.add(c); await db_session.commit()
    db_session.add(CampaignStep(campaign_id=c.id, order=0, agent="zerda", action="zerda.pick_angle"))
    await db_session.commit()
    async def fake_zerda(campaign, step, context, db):
        return StepResult(summary="angle", structured={"topic": "T", "keyword": "menu digital", "rationale": "striking"})
    from app.services import campaign_catalog
    with patch.dict(campaign_catalog.ACTIONS["zerda.pick_angle"].__dict__, {"executor": fake_zerda}):
        await execute_campaign(c.id, db_factory=lambda: _single_session(db_session))
    rec = (await db_session.execute(select(Recommendation))).scalars().first()
    assert rec is not None
    assert rec.anchor_query == "menu digital"
    assert rec.title.startswith("Campaign:")
    # duplicate guard: re-running (resume path re-chains completed steps) must not create a second one
    c.status = "running"; c.cancel_requested = False
    await db_session.commit()
    with patch.dict(campaign_catalog.ACTIONS["zerda.pick_angle"].__dict__, {"executor": fake_zerda}):
        await execute_campaign(c.id, db_factory=lambda: _single_session(db_session))
    recs = (await db_session.execute(select(Recommendation))).scalars().all()
    assert len(recs) == 1


@pytest.mark.asyncio
async def test_campaign_without_angle_creates_no_recommendation(db_session, org_and_project):
    from app.services.campaign_catalog import StepResult
    from app.workers.tasks.campaign_tasks import execute_campaign
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    db_session.add(CampaignStep(campaign_id=c.id, order=0, agent="oasis", action="oasis.market_report"))
    await db_session.commit()
    async def fake_oasis(campaign, step, context, db):
        return StepResult(summary="report", artifact_type="report")
    from app.services import campaign_catalog
    with patch.dict(campaign_catalog.ACTIONS["oasis.market_report"].__dict__, {"executor": fake_oasis}):
        await execute_campaign(c.id, db_factory=lambda: _single_session(db_session))
    recs = (await db_session.execute(select(Recommendation))).scalars().all()
    assert recs == []


@pytest.mark.asyncio
async def test_autotrack_failure_does_not_change_campaign_status(db_session, org_and_project):
    from app.services.campaign_catalog import StepResult
    from app.workers.tasks.campaign_tasks import execute_campaign
    c = Campaign(org_id=FAKE_ORG_ID, project_id=FAKE_PROJECT_ID, goal="g", persona="creator", status="running")
    db_session.add(c); await db_session.commit()
    db_session.add(CampaignStep(campaign_id=c.id, order=0, agent="zerda", action="zerda.pick_angle"))
    await db_session.commit()
    async def fake_zerda(campaign, step, context, db):
        return StepResult(summary="angle", structured={"keyword": "k"})
    from app.services import campaign_catalog
    with patch.dict(campaign_catalog.ACTIONS["zerda.pick_angle"].__dict__, {"executor": fake_zerda}), \
         patch("app.workers.tasks.campaign_tasks.create_recommendation", new=AsyncMock(side_effect=RuntimeError("boom"))):
        await execute_campaign(c.id, db_factory=lambda: _single_session(db_session))
    await db_session.refresh(c)
    assert c.status == "completed"
```

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_campaigns.py -k autotrack -v` → FAIL (no recommendation created / import error).

- [ ] **Step 3: Implement** — in `apps/api/app/workers/tasks/campaign_tasks.py`: add module-scope import `from app.services.recommendation_service import create_recommendation` (module-scope so the test can patch `app.workers.tasks.campaign_tasks.create_recommendation`) and this helper:
```python
async def _autotrack_campaign(campaign, steps, db) -> None:
    """On completion, hand the campaign's angle to Zerda's closed-loop tracking."""
    try:
        keyword = None
        rationale = ""
        for s in steps:
            st = s.structured or {}
            if s.status == "completed" and st.get("keyword"):
                keyword = str(st["keyword"])
                rationale = str(st.get("rationale", ""))
                break
        if not keyword:
            return
        title = f"Campaign: {campaign.goal[:80]}"
        from app.models.recommendation import Recommendation
        from sqlalchemy import select as _select
        existing = (await db.execute(_select(Recommendation).where(
            Recommendation.project_id == campaign.project_id,
            Recommendation.anchor_query == keyword,
            Recommendation.title == title,
        ))).scalars().first()
        if existing is not None:
            return
        await create_recommendation(
            campaign.project_id, campaign.org_id,
            {"source": "agent", "source_agent": "zerda", "title": title,
             "detail": (campaign.goal + ("\n\nAngle: " + rationale if rationale else ""))[:2000],
             "anchor_query": keyword},
            db,
        )
    except Exception:
        logger.exception("campaign auto-track failed: %s", campaign.id)
```
Call it in `execute_campaign` right after the final-status commit, only for completed campaigns:
```python
            await db.refresh(campaign)
            if campaign.cancel_requested:
                campaign.status = "cancelled"
            else:
                campaign.status = "completed" if any_done else "failed"
            await db.commit()
            if campaign.status == "completed":
                await _autotrack_campaign(campaign, steps, db)
```

- [ ] **Step 4: Run to verify pass** — `docker compose exec -T api pytest tests/test_campaigns.py -v` → ALL pass (existing + 3 new).

- [ ] **Step 5: Commit**
```bash
git add apps/api/app/workers/tasks/campaign_tasks.py apps/api/tests/test_campaigns.py
git commit -m "feat(campaigns): auto-track completed campaigns with Zerda (closed loop)"
```

---

### Task 6: `PackagePanel` — artifact cards, Ship to Calendar, Zerda chip

**Files:**
- Create: `apps/web/components/campaigns/PackagePanel.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx` (replace the old package section; delete `PackageLinkCard`/`PackageDetailCard` from the page)

**Interfaces:**
- Consumes: `createCalendarEntry`, `getImage`, `listArticles`, `Campaign`, `CampaignStep`; `agentVisual` (Task 1); i18n `campaigns.ship.*`, `campaigns.trackingChip.*`, `campaigns.composer.*` keys (Task 1).
- Produces: `<PackagePanel projectId campaign onRunAgain={(goal)=>void} />`.

- [ ] **Step 1: Create `apps/web/components/campaigns/PackagePanel.tsx`.** Behavior (write complete code following these exact rules):
  - Derive artifact steps: `campaign.steps.filter(s => s.status === "completed" && s.artifact_type)`.
  - Fetch once: `useQuery(["articles", projectId], () => listArticles(projectId))` to resolve the article artifact (`find(a => a.id === step.artifact_ids?.[0])`) for word count (`campaigns.composer.wordCount`), SEO score (`campaigns.composer.seoScore`), and title; `useQuery(["campaign-image", imageId], () => getImage(imageId), { enabled: !!imageId })` for the visual thumbnail (`structured.image_id`).
  - Cards by `artifact_type` (grid `sm:grid-cols-2 xl:grid-cols-3`, each a `Card` with an agent-gradient header chip via `agentVisual(step.agent)`):
    - `article`: title (article?.title ?? String(step.structured?.title ?? "")), word count + SEO when available, buttons: **Ship** + **Open** (`Link` to `/${projectId}/articles`).
    - `image`: thumbnail (`<img src={image.thumbnail_url ?? image.image_url}>` inside a rounded container), **Ship** button.
    - `social`: `step.summary`, **Review in Social** (`Link` to `/${projectId}/social`).
    - `report` / `analysis`: expandable panel (button toggles) showing `String(step.structured?.markdown ?? step.summary ?? "")` in `whitespace-pre-wrap` text (carries over the old PackageDetailCard behavior).
  - **Ship mutation** (one `useMutation` parameterized by step):
    ```typescript
    function nextMorningISO(daysAhead: number): string {
      const d = new Date();
      d.setDate(d.getDate() + daysAhead);
      d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
    // article: createCalendarEntry(projectId, { content_type: "article", content_id: step.artifact_ids![0], scheduled_at: nextMorningISO(1), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
    // image:   createCalendarEntry(projectId, { content_type: "banner", content_id: String(step.structured!.image_id), scheduled_at: nextMorningISO(2), timezone: ... })
    ```
    Track shipped step ids in local state: button shows `t("campaigns.ship.ship")` → spinner → on success `t("campaigns.ship.shipped")` as a `Link` to `/${projectId}/calendar`; on error toast `t("campaigns.ship.shipFailed")`.
  - **Zerda tracking chip**: derive `keyword = campaign.steps.find(s => s.status === "completed" && (s.structured as any)?.keyword)?.structured?.keyword`; when the campaign is `completed` and keyword exists, render the gradient chip: bold `t("campaigns.trackingChip.title")`, body `t("campaigns.trackingChip.body", { keyword })`, link `t("campaigns.trackingChip.view")` → `/${projectId}/agents/tracking`.
  - Header row: completion badge (`t("campaigns.canvas.stepsDone", {done, total})`) + **Run again** button calling `onRunAgain(campaign.goal)`.
  - All strings via `t()`; NO EMOJI; Tailwind vars only.

- [ ] **Step 2: Wire into the page.** In `page.tsx`: import `PackagePanel`; in the non-planned/non-running branch replace the old package JSX with `<PackagePanel projectId={projectId} campaign={activeCampaign} onRunAgain={(g) => { setActiveCampaignId(null); setSelectedStepId(null); setGoal(g); }} />`; delete the now-unused `PackageLinkCard` and `PackageDetailCard` components and their now-unused imports (typecheck will flag leftovers).

- [ ] **Step 3: Typecheck + smoke**

Run: `cd apps/web && npm run typecheck` → exit 0; `docker compose restart web && sleep 9 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/` → 200/302. Browser: open a completed campaign → cards render; Ship an article → toast + button becomes the calendar link; chip links to tracking.

- [ ] **Step 4: Commit**
```bash
git add apps/web/components/campaigns/PackagePanel.tsx "apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx"
git commit -m "feat(campaigns): package panel with Ship to Calendar and Zerda tracking chip"
```

---

### Task 7: `CampaignComposer` — hero, templates, drafting state, past campaigns

**Files:**
- Create: `apps/web/components/campaigns/CampaignComposer.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx` (replace the no-campaign-selected view)

**Interfaces:**
- Consumes: `listProjects` (persona), `Campaign` list, `CAMPAIGN_TEMPLATES`, `agentVisual`, `AGENT_VISUALS`; i18n `campaigns.composer.*`, `campaigns.templates.*`.
- Produces: `<CampaignComposer projectId campaigns={Campaign[]} goal setGoal onDraft={()=>void} drafting={boolean} onOpenCampaign={(id)=>void} />`.

- [ ] **Step 1: Create `apps/web/components/campaigns/CampaignComposer.tsx`.** Behavior (write complete code following these exact rules):
  - Persona: `useQuery(["projects"], listProjects)` → `projects.find(p => p.id === projectId)?.persona ?? "creator"`.
  - Hero (centered, `max-w-xl mx-auto`): a stacked avatar cluster — the 7 `AGENT_VISUALS` values as overlapping gradient circles (`-ml-2 first:ml-0 border-2 border-background`), pulsing (`animate-pulse-dot`) while `drafting`; headline `t("campaigns.composer.headline")` (text-xl font-bold), subline `t("campaigns.composer.subline")` (text-xs muted).
  - Goal card: `Card` containing a `textarea` (3 rows, `value={goal}`, placeholder `t("campaigns.goalPlaceholder")`) and the CTA `<button className="btn-primary px-5 py-2 text-sm" disabled={drafting || !goal.trim()} onClick={onDraft}>` with label `t("campaigns.composer.cta")`; while `drafting`, label `t("campaigns.drafting")` with a `Loader2 animate-spin` icon.
  - Template chips row under the card: `CAMPAIGN_TEMPLATES.filter(tp => tp.personas.includes(persona))` → pill buttons labeled `t(\`campaigns.templates.${tp.key}.label\`)`; click → `setGoal(t(\`campaigns.templates.${tp.key}.goal\`))`. Hint line `t("campaigns.composer.templatesHint")`.
  - Past campaigns: heading `t("campaigns.composer.past")`; grid of `Card interactive` per campaign: truncated goal, status badge (`t(\`campaigns.status.${c.status}\`)` with the same tone mapping as the page), stacked mini avatars of the plan's agents (`c.steps.map(s => agentVisual(s.agent))`, deduped, max 5), click → `onOpenCampaign(c.id)`. Empty list → `t("campaigns.empty")`.
  - All strings via `t()`; NO EMOJI; Tailwind vars only; animations respect reduced motion (pulse uses the existing `animate-pulse-dot` class — no new keyframes needed).

- [ ] **Step 2: Wire into the page.** Replace the no-campaign-selected JSX with `<CampaignComposer projectId={projectId} campaigns={campaigns} goal={goal} setGoal={setGoal} onDraft={() => draftMutation.mutate()} drafting={draftMutation.isPending} onOpenCampaign={(id) => setActiveCampaignId(id)} />`. Remove the old inline composer + list JSX and any now-unused imports/keys usage.

- [ ] **Step 3: Typecheck + full visual pass**

Run: `cd apps/web && npm run typecheck` → exit 0; restart web; browser: composer (templates switch with persona via the persona-home banner switcher), draft → canvas plan → launch → run animation → package (ship + chip + run again returns to composer with the goal prefilled). Verify BOTH light and dark; verify reduced motion.

- [ ] **Step 4: Commit**
```bash
git add apps/web/components/campaigns/CampaignComposer.tsx "apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx"
git commit -m "feat(campaigns): composer hero with persona templates and past-campaign cards"
```

---

## Final verification

- [ ] Backend: `docker compose exec -T api pytest tests/test_campaigns.py -v` — all PASS (existing + timestamps assertion + 3 auto-track tests).
- [ ] Frontend: `cd apps/web && npm run typecheck` — clean.
- [ ] Restart `docker compose restart api web worker`.
- [ ] Live end-to-end at `http://localhost:3001/<projectId>/campaigns`: template chip → draft → canvas plan with estimates → remove a step via panel → Launch → run mode (pulse, edge flow, live feed, elapsed, progress ring) → package (article/visual/social cards, Ship to Calendar lands a `planned` calendar entry, Zerda chip links to tracking; a tracked Recommendation exists in `/agents/tracking`) → Run again prefills composer.
- [ ] Both themes + reduced-motion verified.
- [ ] Ledger updated; branch `feat/orchestrated-campaigns` ready to push/merge.
