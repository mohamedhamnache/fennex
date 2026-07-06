# Closed-Loop Recommendation Tracking — Design Spec

Date: 2026-07-05
Feature #1 from `docs/superpowers/plans/2026-07-05-fennex-coherence-and-differentiation.md`.

## Purpose

Close the loop that Fennex currently leaves open: an agent finds an opportunity ->
the user acts -> and then **nothing reports back**. This feature persists every
recommendation the user chooses to track, freezes its baseline metrics, and — after the
user acts — measures whether it worked using the project's real Search Console data.

The moat: because Fennex owns both the data (GSC) and the creation/publishing tools, it can
say what no single-purpose competitor can — "when Zerda flagged this query it had 40 clicks;
it now has 182." Accountability is Zerda's job, so this is Zerda's feature.

## Scope (v1)

- Trackable units: **query-linked opportunities AND agent advice** (Zerda/Oasis). Agent advice
  attaches a query anchor when one is available; without an anchor it is a non-measurable
  checklist item.
- Lifecycle: **hybrid** — user accepts to track; the system auto-suggests "looks done" when it
  detects matching published content; the user confirms.
- Impact: **multi-metric score** (clicks, position, impressions, CTR) reduced to a one-line
  verdict (Won / Flat / Declined) plus a per-metric breakdown.
- Surface: a **dedicated Zerda page** at `/[projectId]/agents/tracking`, fed by "Track this"
  buttons where recommendations are generated, plus a weekly-digest standup line.
- Auto-detection source: **published articles + social posts**.
- Architecture: **Approach A** — one table, baseline frozen at accept-time, measurement appended
  to the existing daily `sync_analytics_data` cron. No new cron, no new service process.

Out of scope for v1: user-authored goals; auto-completion without user confirmation; product/
banner content in the matcher; per-user notification push (digest line only).

## Data model

New table `recommendations` (SQLAlchemy model in `app/models/recommendation.py`, Alembic
migration). A row is created **on accept**; the "suggested" state is ephemeral and lives in the
opportunities panel / agent answer, not persisted.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID pk | |
| `org_id` | UUID fk organizations | cascade delete |
| `project_id` | UUID fk projects | cascade delete |
| `source` | str | `"opportunity"` \| `"agent"` |
| `source_agent` | str \| null | `"zerda"` \| `"oasis"` — voice/attribution |
| `kind` | str \| null | `"striking_distance"` \| `"ctr_win"` \| null (agent advice) |
| `title` | str | human label, e.g. "Target 'huile olive bio'" |
| `detail` | Text \| null | opportunity detail / agent advice body |
| `anchor_query` | str \| null | GSC query mapped to; **null = non-measurable checklist item** |
| `anchor_url` | str \| null | target page if known |
| `status` | str | `"tracking"` -> `"done"` \| `"dismissed"` |
| `outcome` | str \| null | `"pending"` -> `"won"` \| `"flat"` \| `"declined"` |
| `impact_score` | float \| null | multi-metric score |
| `baseline` | JSON \| null | `{clicks, impressions, ctr, position, captured_at}` frozen at accept |
| `latest` | JSON \| null | most recent metric snapshot |
| `detected_content` | JSON \| null | `[{type, id, title, matched_on}]` for "looks done" nudges |
| `done_at` | str/date \| null | when marked done |
| `measured_at` | str/date \| null | last measurement run |
| `created_at, updated_at` | via TimestampMixin | |

Statuses persisted: `tracking`, `done`, `dismissed`. Outcome lifecycle: `pending` ->
`won`/`flat`/`declined` (set once the measurement window elapses; null for checklist items).

## Baseline & measurement

- **On accept** (`POST /recommendations`): read the anchor query's current `GscQueryStat`
  metrics and store them in `baseline` with `captured_at`. If there is no anchor query, baseline
  stays null and the item is a checklist item (no verdict).
- **On done** (`PATCH`): set `done_at`.
- **Measurement window:** central constant, default **28 days** after `done_at`. Before it
  elapses, `outcome = "pending"`.
- **Multi-metric score:** weighted delta of `latest` vs `baseline`:
  - weights: clicks 0.45, position 0.25, impressions 0.20, CTR 0.10 (mirrors the health-score
    weighting; note position improvement = a *lower* number).
  - each metric contributes a normalized percentage delta; the weighted sum is `impact_score`.
  - verdict thresholds (central constants): `score > +10` -> **Won**; `-10..+10` -> **Flat**;
    `score < -10` -> **Declined**.
- The UI shows the one-line verdict plus the per-metric breakdown and a plain-language
  baseline->latest line ("40 clicks -> 182 clicks").

**Open implementation detail (pin down in the plan):** the exact window semantics of how
`gsc_service.sync` populates `GscQueryStat` (per-sync snapshot rows vs rolling aggregate) — this
decides how `baseline` and `latest` are diffed. `GscQueryStat` has no `date` column and is
written per sync with `created_at`; confirm by reading `gsc_service.sync` before implementing.

## Auto-detect "looks done"

Runs in the daily pass over `tracking` items. Match against **published articles + social posts**:

- article: normalized token overlap / substring of `anchor_query` (and title tokens) against the
  article title and target keyword.
- social post: same against post content and hashtags.

On a match, write `detected_content` and surface a **"Looks done — confirm?"** nudge on the
Tracking page. The user confirms to transition to `done` (sets `done_at`). Matches never
auto-complete — the human stays in the loop, so false positives cost nothing.

## Backend

- `app/services/recommendation_service.py`:
  - `create_recommendation(...)` — validates, snapshots baseline from `GscQueryStat`.
  - `list_recommendations(project_id, org_id, status?)` — returns rows with computed verdict fields.
  - `transition(id, status)` — done/dismiss; on done sets `done_at`.
  - `run_matching(project_id, db)` — the "looks done" detector over articles + social posts.
  - `measure(project_id, db)` — recompute `latest` + `impact_score` + `outcome` for done items
    whose window has elapsed.
  - `summarize(project_id, db)` — counts + aggregate impact for the digest.
- `app/api/v1/routers/recommendations.py` mounted at `/recommendations`:
  - `POST /recommendations?project_id=` — accept/track (snapshots baseline).
  - `GET  /recommendations?project_id=&status=` — list.
  - `PATCH /recommendations/{id}` — status change (done / dismissed / confirm auto-detected).
  - `GET  /recommendations/summary?project_id=` — digest/standup summary.
- **Cron:** append a `measure_and_match_recommendations(project)` step to the end of the existing
  daily `sync_analytics_data` task (`app/workers/worker.py`), running per project right after the
  fresh GSC sync. No new cron entry, no new worker process.

## Frontend

- `lib/api.ts`: `Recommendation` type + `trackRecommendation()`, `listRecommendations()`,
  `updateRecommendation()`, `dismissRecommendation()`, `getRecommendationSummary()`.
- **"Track this" affordances:**
  - Opportunities panel (analytics growth workspace): a Track button on each `OpportunityRow` ->
    `{source:"opportunity", kind, title, anchor_query, anchor_url}`.
  - Zerda/Oasis answers: a "Track this recommendation" action -> `{source:"agent", source_agent,
    title, detail, anchor_query?}` (anchor optional; non-anchor items are checklist items).
- **Zerda Tracking page** `app/(dashboard)/[projectId]/agents/tracking/page.tsx`, four lanes:
  1. **Needs confirmation** — auto-detected "looks done" items.
  2. **In progress** — `tracking`.
  3. **Measuring** — `done`, window not yet elapsed.
  4. **Results** — verdict pill + per-metric deltas + baseline->latest line.
- **Agents hub:** Zerda gains a "View tracked recommendations" action -> `/agents/tracking`;
  capabilities updated to name the accountability skill.
- **Digest:** a Pack-standup line in `digest_service.py` — e.g. "Zerda: 3 recommendations acted
  on, 2 won (+218 clicks), 1 measuring."

## Verification

- Backend container asserts: create a recommendation -> baseline snapshot captured; transition to
  done -> `measure()` against real/seeded `GscQueryStat` -> assert `impact_score` + verdict;
  `run_matching()` against a published article -> assert detection populates `detected_content`.
- Frontend: `npm run typecheck`; restart api/web/worker; curl the new endpoints.

## Reused infrastructure

- Daily `sync_analytics_data` cron and weekly `send_weekly_digests` (`app/workers/worker.py`).
- `GscQueryStat` / `AnalyticsSnapshot` (`app/models/analytics.py`) for baseline/latest metrics.
- Agent registry (`app/agents/registry.py` + `apps/web/lib/agents.ts`) for Zerda ownership/voice.
- `get_opportunities` (`analytics_service.py`) — source of query-linked opportunities.
- Article + social models for the "looks done" matcher.
- `digest_service.py` for the Pack-standup line.
