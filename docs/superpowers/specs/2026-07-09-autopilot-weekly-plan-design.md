# Autopilot Weekly Plan — Design Spec

Date: 2026-07-09
Feature #5 of the Fennex coherence roadmap
(`docs/superpowers/plans/2026-07-05-fennex-coherence-and-differentiation.md`).
Builds directly on the orchestrated-campaigns feature and Campaign Canvas redesign
(branch `feat/orchestrated-campaigns`, specs of 2026-07-08 and 2026-07-09).

## Purpose

Every Monday the Pack proposes a persona-shaped weekly plan drawn from the project's real
search data. The user reviews it on the Campaign Canvas, approves once, and the Pack executes:
drafts are written, visuals generated, and everything lands on the Content Calendar spread
across the week. One decision per week — the retention ritual the roadmap calls for.

## Decisions (locked during brainstorming)

- Autonomy: **propose → approve → execute**. The Monday proposal is free to generate
  (deterministic, no LLM); execution cost is only incurred on the user's explicit Launch.
- Plan content: **persona-shaped mix**, 3-5 steps tied to real opportunities, each step's
  `why` citing real numbers.
- Activation: **opt-in per project** (`autopilot_enabled`), toggle in Settings → Project.
- Architecture: **Autopilot is a scheduled campaign factory** (approach A) — it creates a
  normal Campaign tagged `source="autopilot"`; review/approve/execute reuse the campaign
  orchestrator and Canvas UI unchanged.

## Experience

- Monday 07:30 UTC (after the 06:00 analytics sync, before the 08:00 digest) a cron generates
  a `planned` Campaign per opted-in project.
- An **AutopilotCard** on the root Home dashboard and the project Overview shows the pending
  plan: step count + estimated cost/time (existing `campaignMeta` estimates), CTA
  "Review & approve" deep-linking to the campaigns page with that campaign selected.
- Review happens on the existing Campaign Canvas plan mode (remove steps via StepPanel);
  **Approve = the existing Launch button**. No new review UI.
- On completion, artifacts auto-ship to the Content Calendar as `planned` entries spread
  across the remaining weekdays at 09:00 (the calendar's arm/publish safety gate is
  unchanged). Zerda auto-track fires via the existing hook.
- The card reflects state: pending plan → review CTA; running → progress; completed →
  "what shipped this week"; disabled or no plan → hidden.
- Campaigns list: autopilot campaigns carry a badge "Autopilot · Week of {date}".

## Backend

### Migration
- `campaigns.source: varchar(20) NOT NULL DEFAULT 'manual'` — values `manual | autopilot`.
- `campaigns.week_of: date NULL` — Monday of the plan's week (set only for autopilot).
- `projects.autopilot_enabled: boolean NOT NULL DEFAULT false`.

### `app/services/autopilot_service.py` (new)
- `generate_weekly_plan(project, db) -> Campaign | None` — deterministic planner:
  - Returns None (no plan) when: `autopilot_enabled` is false, no active GSC connection,
    `get_opportunities` yields nothing, or a campaign with `source="autopilot"` and this
    `week_of` already exists for the project (idempotent).
  - Picks the top opportunity (striking-distance first, then CTR wins) and builds the goal
    string ("Week of {date}: win '{keyword}'").
  - Builds steps from the existing action catalog by persona:
    - creator: `zerda.pick_angle` → `dune.write_article` → `sirocco.generate_visual` →
      `nomad.social_posts`
    - ecommerce: `zerda.pick_angle` → `dune.write_article` (buyer-intent brief) →
      `sirocco.generate_visual` (product-flavored brief)
    - freelancer: `zerda.pick_angle` → `dune.write_article` (authority-piece brief) →
      `nomad.social_posts` (no competitor scan: the deterministic planner has no stored
      competitor URL to feed it; competitor scans stay a manual/campaign action)
  - Briefs and `why` are templated from real opportunity metrics, e.g.
    "'{query}' is at position {pos} with {impressions} impressions — +{potential} potential
    clicks". `director_summary` is a templated one-liner (no LLM call).
  - Creates the Campaign (`status="planned"`, `source="autopilot"`, `week_of=this Monday`,
    persona from the project) + CampaignSteps, commits, returns it.

### Cron
- `run_autopilot_planner` in `app/workers/tasks/` — iterates projects with
  `autopilot_enabled`, calls `generate_weekly_plan` per project, each wrapped in
  try/except so one project cannot break the batch. Registered:
  `cron(run_autopilot_planner, weekday=0, hour=7, minute=30)`.

### Ship-to-calendar hook
- In `execute_campaign` right after the final-status commit (next to `_autotrack_campaign`,
  same isolation contract — wrapped in try/except, logged, never affects campaign status):
  if `campaign.status == "completed"` and `campaign.source == "autopilot"`:
  - Article artifact → CalendarEntry `content_type="article"`, visual artifact →
    `content_type="banner"`; scheduled at 09:00 UTC spread across the remaining weekdays of
    `week_of`'s week (first artifact tomorrow-or-Tuesday, next artifact the following
    weekday; if the week is exhausted, roll into early next week). Entries land as
    `planned` (no target required; the calendar gate governs publishing).
  - Duplicate guard: skip any artifact that already has a CalendarEntry with the same
    `content_type` + `content_id` (resume-safe).
  - Social drafts are not scheduled (no per-post ids — same v1 scope as campaigns).

### API surface
- `ProjectUpdate`/`ProjectResponse` gain `autopilot_enabled`.
- Campaigns serializer exposes `source` and `week_of`.
- No new routers: the AutopilotCard reads `listCampaigns` (which now includes
  source/week_of) and the existing campaign endpoints.

## Frontend

- `apps/web/lib/api.ts`: `Campaign` gains `source: string` and `week_of: string | null`;
  `Project` gains `autopilot_enabled: boolean`; `updateProject` picks it up.
- **Settings → Project**: an Autopilot toggle row (switch + one-line description) saved via
  the existing `updateProject` mutation in `ProjectSection`.
- **`apps/web/components/autopilot/AutopilotCard.tsx`** (new): given the campaigns list,
  finds the current-week autopilot campaign (`source === "autopilot"`, `week_of` = this
  week's Monday) and renders by its status:
  - `planned` → "The Pack planned your week" + step count + estimated total
    (`sumEstimates`/`fmtEstimate` from `campaignMeta`) + "Review & approve" link to
    `/{projectId}/campaigns?campaign={id}`.
  - `running` → progress (completed/total steps) + link.
  - `completed` → shipped summary (artifact counts) + link to calendar.
  - Otherwise (none, failed, cancelled, disabled) → renders nothing. Failed/cancelled
    plans remain visible on the campaigns page itself.
- Mounted on the root Home dashboard (`app/(dashboard)/page.tsx`, above the KPI row) and
  the project Overview (above MissionControl).
- **Campaigns page**: accept a `?campaign={id}` query param to preselect a campaign
  (deep link target); autopilot campaigns show a badge "Autopilot · Week of {date}" in the
  past-campaigns list and canvas header.
- Full i18n under a new `autopilot.*` block in en/fr/es/de/pt/ar; dates formatted with the
  active i18n locale. NO EMOJI.

## Error handling

- No opportunities / no GSC / disabled → no plan, no card. Never fabricate.
- Planner idempotent per (project, week_of); cron failure on one project does not affect
  others.
- Unapproved plan from a previous week: superseded — the new Monday run creates this
  week's plan; the old `planned` autopilot campaign for a past `week_of` is auto-cancelled
  by the planner (status → `cancelled`) so the card always points at the current week.
- Execution failures: existing campaign partial-completion behavior, visible on the canvas.
- Ship/track hooks: isolated try/except; failures logged, campaign status untouched.

## Testing

Backend (pytest, existing campaigns harness + calendar tables):
- Planner builds the persona-shaped plan from seeded opportunities (assert step actions
  per persona, why contains the metric numbers, week_of = Monday).
- Opt-in filter: disabled project → None. No GSC/opportunities → None.
- Idempotency: second call same week → None (no duplicate campaign).
- Past-week `planned` autopilot campaign is cancelled and replaced on the next run.
- Ship hook: completed autopilot campaign creates `planned` CalendarEntries (article +
  banner, dates within the week, 09:00), duplicate guard on resume, failure isolation
  (hook raising does not change campaign status), and manual campaigns do NOT ship.
Frontend: `npm run typecheck`; visual pass (card states, toggle, badge, deep link) in
both themes.

## Reused infrastructure

`get_opportunities` (real GSC), campaign models/orchestrator/executors/catalog, Campaign
Canvas UI + `campaignMeta` estimates, `_autotrack_campaign`, `calendar_service` +
CalendarEntry safety gate, arq cron worker, Settings → Project section, i18n.
