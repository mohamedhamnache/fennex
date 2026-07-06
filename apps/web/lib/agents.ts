/** The Fennex Pack — named AI agent identities (frontend mirror of
 *  apps/api/app/agents/registry.py — keep both in sync). */
import {
  Radar, Wind, ScrollText, Wand2, Footprints, Palmtree, Compass,
  type LucideIcon,
} from "lucide-react";
import type { ProjectPersona } from "./api";

export type AgentId = "zerda" | "sirocco" | "dune" | "mirage" | "sable" | "oasis" | "nomad";

export interface FennexAgent {
  id: AgentId;
  name: string;
  role: string;
  tagline: string;
  Icon: LucideIcon;
  capabilities: string[];
  personaFit: ProjectPersona[];
}

export const FENNEX_AGENTS: Record<AgentId, FennexAgent> = {
  zerda: {
    id: "zerda",
    name: "Zerda",
    role: "SEO & Market Strategist",
    tagline: "Hears everything happening in the search desert",
    Icon: Radar,
    capabilities: [
      "Answers questions about your real Search Console data",
      "Finds striking-distance keywords and CTR quick wins",
      "Explains traffic changes with charts",
      "Recommends what to create or fix next",
      "Tracks its recommendations and reports whether they worked",
    ],
    personaFit: ["creator", "ecommerce", "freelancer"],
  },
  sirocco: {
    id: "sirocco",
    name: "Sirocco",
    role: "Creative Director",
    tagline: "Thinks in campaigns, not single assets",
    Icon: Wind,
    capabilities: [
      "Plans coordinated multi-asset campaigns from one goal",
      "Generates platform-ready visuals with captions",
      "Applies your brand kit across every asset",
      "Improves image prompts like a pro",
    ],
    personaFit: ["creator", "ecommerce"],
  },
  dune: {
    id: "dune",
    name: "Dune",
    role: "Content Writer",
    tagline: "Builds articles that accumulate rank over time",
    Icon: ScrollText,
    capabilities: [
      "Writes SEO-optimized long-form articles",
      "Adapts to your brand voice and niche",
      "Generates social posts from your content",
      "Suggests images for every article section",
    ],
    personaFit: ["creator"],
  },
  mirage: {
    id: "mirage",
    name: "Mirage",
    role: "Image Artisan",
    tagline: "Transforms what you see",
    Icon: Wand2,
    capabilities: [
      "Edits images from plain-language commands",
      "Chains multiple edits in one request",
      "Converts flat images into editable layers",
      "Scores and SEO-optimizes your visuals",
    ],
    personaFit: ["creator", "ecommerce"],
  },
  sable: {
    id: "sable",
    name: "Sable",
    role: "Competitor Scout",
    tagline: "Moves through rival territory quietly",
    Icon: Footprints,
    capabilities: [
      "Crawls any competitor page on demand",
      "Scores their on-page SEO out of 100",
      "Compares their content to your real demand",
      "Pinpoints the gaps worth striking first",
    ],
    personaFit: ["ecommerce", "freelancer"],
  },
  oasis: {
    id: "oasis",
    name: "Oasis",
    role: "Market Researcher",
    tagline: "Turns raw demand into client-ready market reports",
    Icon: Palmtree,
    capabilities: [
      "Writes complete market reports from your real search data",
      "Sizes demand and maps the topic landscape",
      "Quantifies opportunities and names the risks",
      "Client-ready output you can copy or download",
    ],
    personaFit: ["ecommerce", "freelancer"],
  },
  nomad: {
    id: "nomad",
    name: "Nomad",
    role: "Outreach Agent",
    tagline: "Goes out and finds your next clients on LinkedIn",
    Icon: Compass,
    capabilities: [
      "Plans a full week of LinkedIn posts from one goal",
      "Saves every post as a draft ready to publish",
      "Writes connection and follow-up DM templates",
      "Outreach tips tuned to your niche and services",
    ],
    personaFit: ["freelancer", "creator"],
  },
};

/** All planned agents are now live — kept for future roster growth. */
export const UPCOMING_AGENTS: { name: string; role: string; tagline: string; Icon: LucideIcon }[] = [];
