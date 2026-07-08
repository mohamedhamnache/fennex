# Campaign Canvas — Full Campaigns UX Redesign — Design Spec

Date: 2026-07-09
Redesign of the Orchestrated Multi-Agent Campaigns UI (feature #2, built on branch
`feat/orchestrated-campaigns`; see `docs/superpowers/specs/2026-07-08-orchestrated-campaigns-design.md`).

## Purpose

Replace the functional-but-plain campaigns page with a signature, market-differentiating
experience: the campaign as a living **pipeline canvas** where the goal flows through the Pack's
agent nodes into a package. Add four unique features (cost/time estimates, Ship to Calendar,
Zerda auto-tracking, persona templates) that exploit what only Fennex owns — the calendar and the
closed measurement loop.

## Decisions (locked during brainstorming, via visual companion)

- Direction: **C — Pipeline Canvas** for the whole lifecycle (over Mission Control and Aurora
  Editorial directions).
- Atmosphere: **theme-aware** — "Light Studio" (paper-white, dot-grid, clean nodes with colored
  state rings) in light mode; "Dark Observatory" (starfield gradient, glowing nodes, aurora
  edges) in dark mode. The app already uses class-based dark mode.
- Features: cost+time estimates, Ship to Calendar, Zerda auto-track, persona quick-start
  templates — all four in scope.
- Mockups persisted at `.superpowers/brainstorm/120898-1783548131/content/` (visual-direction,
  canvas-atmosphere, composer-package screens).

## Experience — one route, two views

Route stays `/[projectId]/campaigns`.

### View 1 — Composer ("Brief the Pack"), when no campaign is selected
- Hero: stacked Pack avatar cluster, headline "What should the Pack achieve?", subline, a large
  goal input card with the aurora gradient CTA ("Design my campaign").
- **Persona template chips** under the input: 3 per persona (creator / ecommerce / freelancer),
  static i18n'd briefs (e.g. freelancer: "Launch a new offer", "Own a topic in my niche",
  "Seasonal content push"); clicking prefills the goal textarea. Chips labeled "Templates tuned
  to your persona"; persona read from the project (fallback creator).
- Drafting state: while `createCampaign` runs, an animated "the Pack is designing your campaign"
  state (pulsing avatars). Respect `prefers-reduced-motion`.
- Below the hero: past campaigns as cards (goal, status ring, stacked agent avatars, created
  date); clicking opens the canvas view for that campaign.

### View 2 — Canvas, when a campaign is selected/created
A single `CampaignCanvas` renders the campaign as a node graph and adapts by `campaign.status`:

**Layout (deterministic, no drag):** goal node fixed left; package node fixed right; agent step
nodes laid out left-to-right by step `order`. Context-producing steps (`oasis.market_report`,
`zerda.pick_angle`, `sable.competitor_scan`) fan across upper/lower lanes; artifact steps
(`dune.write_article`, `sirocco.generate_visual`, `nomad.social_posts`) converge toward the
package node. Edges are cubic bezier SVG paths: goal → first steps, step(i) → step(i+1) (by
order), last steps → package. Canvas is horizontally scrollable on narrow screens.

**Plan mode (`status == "planned"`):**
- Nodes show agent avatar + name + action label + per-node **estimate** (cost range + duration).
- Click a node → `StepPanel` (side panel): the director's `why`, the action description, brief
  parameters as editable inputs for the action's declared params (persist via
  `updateCampaignPlan` is NOT param-editing — see API note below), and **Remove step**
  (calls the existing `updateCampaignPlan(id, remainingStepIds)`).
- An estimates bar: total estimated cost + duration + step count, next to the aurora **Launch
  campaign** button (`runCampaign`). Director's `summary` shown as Sirocco's note above the
  canvas.
- API note: the existing PATCH `/plan` accepts only `step_ids` (reorder/remove). Brief-param
  editing in the side panel is v1-visible but read-only UNLESS the plan-edit endpoint is
  extended; to keep backend churn minimal, v1 ships param editing as read-only display of the
  brief, with Remove as the only mutation. (Reorder via drag is out of scope; the endpoint
  supports it for a future iteration.)

**Run mode (`status == "running"`):**
- Poll `getCampaign(id)` every 2.5s (existing pattern; stops when not running).
- Completed nodes: green state ring + check. Active node (first `running`, else first `pending`):
  aurora glow + soft pulse ring; its incoming edge animates (CSS `stroke-dashoffset` flow).
  Pending nodes: dashed/dimmed. Failed: destructive ring. Skipped: muted with a skip badge.
- **Live feed strip** under the canvas: the latest 2-3 completed steps' `summary` lines, each
  prefixed by the agent name in its color ("Zerda — Focus: …"). Progress ring (completed/total),
  elapsed time (client-side from run start), Cancel button (`cancelCampaign`).
- All animations gated on `prefers-reduced-motion`.

**Package mode (`status in completed/failed/cancelled`):**
- The package node expands into a `PackagePanel` of artifact cards from completed steps:
  - Article (Dune): title, word count, SEO score (fields exist on the Article), buttons
    **Ship to Calendar** + **Open** (links to articles page).
  - Visual (Sirocco): image thumbnail (via existing image fetch), **Ship to Calendar**.
  - Social (Nomad): "N LinkedIn drafts", **Review in Social** (link) — no per-post ids are
    exposed by the executor, so no direct scheduling of individual posts in v1.
  - Report (Oasis) / Analysis (Sable): expandable panels (summary / structured.markdown as
    preformatted text) — carried over from the current package view.
- Header: goal + completion badge (steps done, actual elapsed if derivable from step
  timestamps; the estimate otherwise) + **Run again** (prefills the composer with the same goal).
- **Zerda tracking chip** (see feature 3): "Zerda is tracking this campaign — targeting
  '<keyword>' …" with a link to `/agents/tracking`. Shown when the campaign has an angle step
  with a keyword (tracking is created server-side on completion).
- Failed campaign: same canvas with failed nodes visible; package shows whatever completed.
  Cancelled: remaining nodes dimmed.

## The four unique features

1. **Cost + time estimates** — frontend-only static metadata in `apps/web/lib/campaignMeta.ts`:
   per action key `{costMin, costMax, minutesMin, minutesMax}` plus per-agent visuals (icon,
   gradient). Node shows "~$0.15–0.30 · 2–4 min"; the plan bar sums ranges. Always labeled
   estimated (i18n).
2. **Ship to Calendar** — reuses the existing calendar API (`createCalendarEntry`):
   - Article card → `{content_type: "article", content_id, scheduled_at: tomorrow 09:00 local
     → ISO UTC, timezone: browser tz}`.
   - Visual card → `{content_type: "banner", content_id: image id, scheduled_at: +2 days 09:00}`.
   - On success: toast + the button becomes "Scheduled — view calendar" linking to
     `/[projectId]/calendar`. Entries land as `planned` (the calendar's safety gate is
     unchanged; user arms/publishes there).
3. **Zerda auto-track** — the only backend change. In `execute_campaign`
   (`app/workers/tasks/campaign_tasks.py`), after the final status is set to `completed`:
   if any completed step has `structured.keyword` (the Zerda angle), call
   `recommendation_service.create_recommendation(project_id, org_id, {source: "agent",
   source_agent: "zerda", title: "Campaign: " + goal[:80], detail: campaign goal + angle
   rationale, anchor_query: keyword}, db)` wrapped in try/except (a tracking failure must never
   affect the campaign). Baseline snapshots automatically (existing service behavior); when the
   user later publishes the article, the existing looks-done matcher nudges confirmation and the
   28-day measurement runs — the full closed loop, automatic.
   Guard against duplicates: skip creation if a recommendation with the same `anchor_query` and
   title already exists for the project. Tests: creates rec with keyword; no angle → no rec;
   hook exception does not change campaign status.
4. **Persona templates** — static array in `campaignMeta.ts`: 3 briefs per persona
   `{key, personas, goalKey}` with goals in i18n (`campaigns.templates.*`).

## Architecture & file structure (frontend decomposition)

No new dependencies. The current 433-line `page.tsx` is decomposed:

- `apps/web/lib/campaignMeta.ts` — agent visuals (icon/gradient per Pack agent), action
  estimates, persona templates. Pure data + tiny helpers.
- `apps/web/components/campaigns/CampaignCanvas.tsx` — layout algorithm (pure function:
  steps → node positions + edge list), SVG edge layer, node positioning; renders `CanvasNode`s;
  mode-aware styling (plan/run/package), theme via Tailwind `dark:` variants.
- `apps/web/components/campaigns/CanvasNode.tsx` — goal / agent / package node variants with
  state rings, glow, estimate line, click handling.
- `apps/web/components/campaigns/StepPanel.tsx` — side panel for a selected node (why, brief
  display, remove).
- `apps/web/components/campaigns/LiveFeed.tsx` — run-mode feed strip + progress ring + elapsed +
  cancel.
- `apps/web/components/campaigns/PackagePanel.tsx` — artifact cards incl. Ship to Calendar
  buttons + Zerda tracking chip (absorbs the current `PackageLinkCard`/`PackageDetailCard`).
- `apps/web/components/campaigns/CampaignComposer.tsx` — hero, template chips, drafting
  animation, past-campaign cards.
- `page.tsx` — thin orchestrator: selected campaign state, queries/mutations, view switch.

Canvas rendering: absolutely-positioned node divs over an SVG edge layer inside a
relative container with fixed row heights; edge paths computed from node positions. Animations
via existing CSS conventions (`animate-*`), new keyframes added to `globals.css` (edge flow,
node pulse) with `prefers-reduced-motion` media guards.

## i18n

All new user-visible strings via `t()` under the existing `campaigns.*` block (new sub-keys:
`canvas.*`, `estimates.*`, `ship.*`, `tracking.*`, `templates.*`, `composer.*`). Keys added to
`apps/web/public/locales/en/common.json`; other locales fall back to en. NO EMOJI anywhere.

## Error handling

- Draft failure (no LLM key → 400): toast with the server message; composer stays filled.
- Ship to Calendar failure: toast; button returns to normal.
- Step failure: red-ring node + error in its StepPanel; campaign completes partial (existing
  orchestrator behavior, now spatially visible).
- Auto-track hook failure: swallowed server-side (logged), never affects campaign status.
- Canvas with 1-2 steps (fallback plans) still lays out sensibly (goal → node(s) → package).

## Testing

- Backend (pytest, existing `tests/test_campaigns.py` harness): auto-track hook — completed
  campaign with angle keyword creates a Recommendation (assert anchor_query); campaign without
  an angle creates none; a raising recommendation service does not change the campaign's final
  status; duplicate-guard skips a second creation.
- Frontend: `npm run typecheck`; visual verification in BOTH light and dark modes across the
  three canvas modes + composer; reduced-motion check.

## Scope / phasing (one spec, phased plan)

- **Phase A** — `campaignMeta.ts`, canvas core (`CampaignCanvas`, `CanvasNode`, `StepPanel`,
  `LiveFeed`), page rewrite with plan + run modes, estimates, i18n keys.
- **Phase B** — `PackagePanel` (Ship to Calendar), Zerda auto-track hook (backend + tests),
  `CampaignComposer` with templates + past-campaign cards, dark-mode polish pass.

Work continues on branch `feat/orchestrated-campaigns` (13 unmerged commits) since the redesign
builds directly on it.

## Reused infrastructure

- Campaigns API client (Task 6 of the campaigns feature): `createCampaign`, `listCampaigns`,
  `getCampaign`, `updateCampaignPlan`, `runCampaign`, `cancelCampaign`.
- Calendar API (`createCalendarEntry`); recommendation service (`create_recommendation`);
  Pack registry visuals (`lib/agents.ts` icons); aurora CTA + animation classes in
  `globals.css`; TanStack Query polling pattern; i18n.
