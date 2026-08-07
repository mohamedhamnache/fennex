import type { CampaignStatus } from "@/lib/api";
import { cn } from "@/lib/cn";

/**
 * One place that knows what a campaign status looks like.
 *
 * There were two copies of this map, and the lifecycle grew from five states to
 * ten -- so both went stale at once, in different ways. Colour carries meaning
 * here: money is moving (running), waiting on a person (planning), or finished.
 * Anything not yet live stays neutral, so a list of drafts does not read as a
 * list of alarms.
 */
export const CAMPAIGN_STATUS_BADGE: Record<CampaignStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  planning: "bg-muted text-muted-foreground",
  ready: "bg-foreground/8 text-foreground",
  scheduled: "bg-primary/10 text-primary",
  running: "bg-primary/12 text-primary",
  paused: "bg-warning/12 text-warning",
  completed: "bg-success/12 text-success",
  archived: "bg-muted text-muted-foreground",
  failed: "bg-destructive/12 text-destructive",
  // Retired, kept so a cached row from before the migration still renders.
  planned: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
};

/** i18n key for a status. Falls back to the raw value for anything unmapped. */
export function statusKey(status: CampaignStatus): string {
  return `campaigns.status.${status}`;
}

export function statusBadgeClass(status: CampaignStatus): string {
  return cn("shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold",
            CAMPAIGN_STATUS_BADGE[status] ?? CAMPAIGN_STATUS_BADGE.draft);
}

/** Statuses where the campaign is live and its numbers are still moving. */
export const LIVE_STATUSES: CampaignStatus[] = ["running", "scheduled"];

/** The order a command centre should show status groups in. */
export const STATUS_ORDER: CampaignStatus[] = [
  "running", "scheduled", "ready", "planning", "draft",
  "paused", "completed", "failed", "archived",
];

/**
 * The colour of a campaign's status rail.
 *
 * A four-pixel stripe down the edge of a row, rather than a badge in the
 * corner: state is what a person scans a list for, and colour at the edge is
 * read before any word in the row. Deliberately quiet for everything that is
 * not live or broken — a list of drafts should not look like a list of alarms.
 */
export const STATUS_RAIL: Record<CampaignStatus, string> = {
  draft: "bg-border",
  planning: "bg-border",
  ready: "bg-foreground/25",
  scheduled: "bg-primary/50",
  running: "bg-primary",
  paused: "bg-warning",
  completed: "bg-success",
  archived: "bg-border",
  failed: "bg-destructive",
  planned: "bg-border",
  cancelled: "bg-border",
};
