import type { AgentId } from "@/lib/agents";
import type { ProjectPersona } from "@/lib/api";

/**
 * Persona goals — the "propose the right tools for each project" layer.
 * Each persona offers a few concrete goals; each goal fields an expert squad
 * (Pack agents) and an ordered sequence of steps pointing at the right in-app
 * tool. Copy is referenced by i18n key so it stays translatable; routes are
 * project-relative. The first goal of each persona is its flagship (default).
 */
export interface PlaybookStep {
  agent: AgentId;
  route: string; // relative to /[projectId]/
  labelKey: string;
}

export interface PlaybookGoal {
  id: string;
  titleKey: string;
  subtitleKey: string;
  squad: AgentId[];
  steps: PlaybookStep[];
}

/** i18n key prefix for a persona goal's copy. Flagship goals reuse the older
 * `startProject.pb.<persona>` block; the rest live under `startProject.goals`. */
const flagship = (persona: ProjectPersona) => `startProject.pb.${persona}`;
const goalKey = (persona: ProjectPersona, id: string) => `startProject.goals.${persona}.${id}`;

function goal(
  persona: ProjectPersona,
  id: string,
  prefix: string,
  squad: AgentId[],
  steps: { agent: AgentId; route: string }[],
): PlaybookGoal {
  return {
    id,
    titleKey: `${prefix}.title`,
    subtitleKey: `${prefix}.subtitle`,
    squad,
    steps: steps.map((s, i) => ({ ...s, labelKey: `${prefix}.s${i + 1}` })),
  };
}

export const PERSONA_GOALS: Record<ProjectPersona, PlaybookGoal[]> = {
  creator: [
    goal("creator", "audience", flagship("creator"), ["zerda", "dune", "mirage", "sirocco"], [
      { agent: "zerda", route: "keywords" },
      { agent: "dune", route: "articles" },
      { agent: "mirage", route: "images" },
      { agent: "sirocco", route: "social" },
    ]),
    goal("creator", "series", goalKey("creator", "series"), ["zerda", "dune", "sirocco"], [
      { agent: "zerda", route: "keywords" },
      { agent: "dune", route: "articles" },
      { agent: "sirocco", route: "social" },
    ]),
    goal("creator", "repurpose", goalKey("creator", "repurpose"), ["dune", "mirage", "sirocco"], [
      { agent: "dune", route: "articles" },
      { agent: "mirage", route: "images" },
      { agent: "sirocco", route: "social" },
    ]),
  ],
  ecommerce: [
    goal("ecommerce", "launch", flagship("ecommerce"), ["zerda", "mirage", "dune", "sirocco"], [
      { agent: "zerda", route: "keywords" },
      { agent: "mirage", route: "images/studio?mode=create&intent=product" },
      { agent: "dune", route: "articles" },
      { agent: "sirocco", route: "social" },
    ]),
    goal("ecommerce", "catalog", goalKey("ecommerce", "catalog"), ["zerda", "dune"], [
      { agent: "zerda", route: "seo" },
      { agent: "dune", route: "articles" },
      { agent: "dune", route: "publishing" },
    ]),
    goal("ecommerce", "promo", goalKey("ecommerce", "promo"), ["sirocco", "mirage", "dune"], [
      { agent: "sirocco", route: "campaigns" },
      { agent: "mirage", route: "images/studio?mode=create&intent=product" },
      { agent: "dune", route: "social" },
    ]),
  ],
  freelancer: [
    goal("freelancer", "clients", flagship("freelancer"), ["oasis", "nomad", "dune", "sable"], [
      { agent: "oasis", route: "analytics?ws=market&oasis=1" },
      { agent: "nomad", route: "agents/nomad" },
      { agent: "dune", route: "articles" },
      { agent: "sable", route: "analytics?ws=competitors" },
    ]),
    goal("freelancer", "authority", goalKey("freelancer", "authority"), ["zerda", "dune", "sirocco"], [
      { agent: "zerda", route: "keywords" },
      { agent: "dune", route: "articles" },
      { agent: "sirocco", route: "social" },
    ]),
    goal("freelancer", "outreach", goalKey("freelancer", "outreach"), ["nomad", "mirage", "sirocco"], [
      { agent: "nomad", route: "agents/nomad" },
      { agent: "mirage", route: "images" },
      { agent: "sirocco", route: "social" },
    ]),
  ],
  company: [
    goal("company", "brand", flagship("company"), ["zerda", "dune", "sirocco", "sable"], [
      { agent: "zerda", route: "seo" },
      { agent: "dune", route: "articles" },
      { agent: "sirocco", route: "campaigns" },
      { agent: "sable", route: "social" },
    ]),
    goal("company", "campaign", goalKey("company", "campaign"), ["sirocco", "mirage", "dune"], [
      { agent: "sirocco", route: "campaigns" },
      { agent: "mirage", route: "images" },
      { agent: "dune", route: "social" },
    ]),
    goal("company", "defend", goalKey("company", "defend"), ["sable", "zerda", "dune"], [
      { agent: "sable", route: "analytics?ws=competitors" },
      { agent: "zerda", route: "seo" },
      { agent: "dune", route: "articles" },
    ]),
  ],
};
