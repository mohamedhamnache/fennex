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
  "sirocco.multi_network_social": { costMin: 0.04, costMax: 0.1, minMinutes: 1, maxMinutes: 2 },
  "oasis.define_icp": { costMin: 0.02, costMax: 0.05, minMinutes: 1, maxMinutes: 1 },
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
