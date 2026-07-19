import type { AgentId } from "@/lib/agents";
import type { ProjectPersona } from "@/lib/api";

/**
 * Persona playbooks — the "propose the right tools for each project" layer.
 * Each persona gets a flagship playbook: an expert squad (Pack agents) and an
 * ordered sequence of steps, each pointing at the right in-app tool. Copy is
 * referenced by i18n key so it stays translatable; routes are project-relative.
 */
export interface PlaybookStep {
  agent: AgentId;
  route: string; // relative to /[projectId]/
  labelKey: string;
}

export interface Playbook {
  persona: ProjectPersona;
  titleKey: string;
  subtitleKey: string;
  squad: AgentId[];
  steps: PlaybookStep[];
}

export const PLAYBOOKS: Record<ProjectPersona, Playbook> = {
  creator: {
    persona: "creator",
    titleKey: "startProject.pb.creator.title",
    subtitleKey: "startProject.pb.creator.subtitle",
    squad: ["zerda", "dune", "mirage", "sirocco"],
    steps: [
      { agent: "zerda", route: "keywords", labelKey: "startProject.pb.creator.s1" },
      { agent: "dune", route: "articles", labelKey: "startProject.pb.creator.s2" },
      { agent: "mirage", route: "images", labelKey: "startProject.pb.creator.s3" },
      { agent: "sirocco", route: "social", labelKey: "startProject.pb.creator.s4" },
    ],
  },
  ecommerce: {
    persona: "ecommerce",
    titleKey: "startProject.pb.ecommerce.title",
    subtitleKey: "startProject.pb.ecommerce.subtitle",
    squad: ["zerda", "mirage", "dune", "sirocco"],
    steps: [
      { agent: "zerda", route: "keywords", labelKey: "startProject.pb.ecommerce.s1" },
      { agent: "mirage", route: "images", labelKey: "startProject.pb.ecommerce.s2" },
      { agent: "dune", route: "articles", labelKey: "startProject.pb.ecommerce.s3" },
      { agent: "sirocco", route: "social", labelKey: "startProject.pb.ecommerce.s4" },
    ],
  },
  freelancer: {
    persona: "freelancer",
    titleKey: "startProject.pb.freelancer.title",
    subtitleKey: "startProject.pb.freelancer.subtitle",
    squad: ["oasis", "nomad", "dune", "sable"],
    steps: [
      { agent: "oasis", route: "analytics?ws=market&oasis=1", labelKey: "startProject.pb.freelancer.s1" },
      { agent: "nomad", route: "agents/nomad", labelKey: "startProject.pb.freelancer.s2" },
      { agent: "dune", route: "articles", labelKey: "startProject.pb.freelancer.s3" },
      { agent: "sable", route: "analytics?ws=competitors", labelKey: "startProject.pb.freelancer.s4" },
    ],
  },
  company: {
    persona: "company",
    titleKey: "startProject.pb.company.title",
    subtitleKey: "startProject.pb.company.subtitle",
    squad: ["zerda", "dune", "sirocco", "sable"],
    steps: [
      { agent: "zerda", route: "seo", labelKey: "startProject.pb.company.s1" },
      { agent: "dune", route: "articles", labelKey: "startProject.pb.company.s2" },
      { agent: "sirocco", route: "campaigns", labelKey: "startProject.pb.company.s3" },
      { agent: "sable", route: "social", labelKey: "startProject.pb.company.s4" },
    ],
  },
};
