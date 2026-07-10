# Scheduled Market/Competitor Monitoring — Design Spec

Date: 2026-07-10
Feature #6 (final) of the Fennex coherence roadmap
(`docs/superpowers/plans/2026-07-05-fennex-coherence-and-differentiation.md`).

## Purpose

The Pack keeps watch between sessions: Zerda flags ranking moves on your real queries, Sable
re-scans watched competitor pages, Oasis spots new market demand — and files everything into an
alerts inbox with a bell in the top bar. Turns the closed loop proactive: Fennex tells you when
something moved instead of waiting to be asked. All detection is deterministic (zero LLM cost).

## Decisions (locked during brainstorming)

- Alert form: **dedicated alerts inbox** (new `Alert` model, bell + inbox page), each alert
  deep-linked to an action so it is never a dead end. (Chosen over recommendations-feed and
  digest-only.)
- Monitors (all three in v1): **ranking moves** (daily), **competitor page changes** (weekly,
  watchlist-driven), **market shifts** (weekly).
- Architecture: **one monitoring engine, snapshot-diff based** (approach A) — three detectors
  sharing one pattern: build snapshot → diff vs stored previous → emit alerts → store new
  snapshot.
- Activation is data-driven, no new toggle: rankings + market monitors run automatically for
  projects with an active GSC connection; the competitor monitor runs only for projects with a
  non-empty watchlist (inherently opt-in).

## Data model (3 tables, one migration)

- **`watched_competitors`** — `id, org_id, project_id, url (String 2048), label (String 200,
  nullable), last_scorecard (JSON, nullable), last_scanned_at (String 50, nullable)` +
  timestamps. Unique `(project_id, url)`.
- **`monitor_snapshots`** — `id, org_id, project_id, kind (String 30: "rankings" | "market"),
  payload (JSON), taken_at (String 50)` + timestamps. One row per `(project_id, kind)`,
  upserted: the detector reads the previous payload, diffs, then overwrites. (Needed because
  `GscQueryStat` is replaced wholesale on every GSC sync — historical comparison requires our
  own kept state.)
- **`alerts`** — `id, org_id, project_id, kind (String 30: "ranking_drop" | "ranking_gain" |
  "competitor_change" | "market_shift"), severity (String 10: "info" | "warning" | "critical"),
  title (String 500), detail (Text, nullable), url (String 500 — app-relative deep link),
  is_read (Boolean, default false), dedupe_key (String 200)` + timestamps.
  **Unique `(project_id, dedupe_key)`**; the key embeds the ISO week
  (e.g. `ranking_drop:menu digital:2026-W28`), so a persisting condition alerts at most once
  per week and cron re-runs are idempotent (insert skipped on conflict). Index
  `(project_id, is_read)`.

## The three detectors (`app/services/monitoring_service.py`)

Shared contract: each detector `async def detect_*(project, db) -> int` (returns alerts
created), wrapped by callers in try/except (a detector failure never breaks its caller).
**First run per (project, kind): store the snapshot, emit nothing** — no false flood.

1. **Rankings — Zerda, daily.** Invoked at the end of `_sync_one_project` in
   `analytics_tasks.py`, next to the existing `measure`/`run_matching` calls, inside the same
   try/except pattern; runs only for projects with an active GSC connection (the caller
   context guarantees fresh data). Snapshot payload: top 200 `GscQueryStat` rows as
   `{query: {position, clicks, impressions}}`. Diff rules:
   - **Drop**: position worsened by >= 3.0 AND current impressions >= 50 →
     `ranking_drop`; severity `critical` if it fell off page 1 (was <= 10, now > 10), else
     `warning`. Title cites the query; detail cites old → new position + impressions.
   - **Gain**: position improved by >= 3.0 AND new position <= 10 → `ranking_gain`, `info`.
   - Deep link: `/{projectId}/analytics`.
2. **Competitor — Sable, weekly cron (Tuesday 07:00 UTC).** For each `watched_competitors`
   row of each project that has any: re-crawl and scorecard the URL by reusing
   `competitor_service` internals — expose a public `scan_scorecard(url) -> dict` helper
   wrapping the existing `_crawl` + `_scorecard` (no LLM insights call). Diff vs
   `last_scorecard`: title changed, meta description changed, `word_count` changed >= 20%,
   `h2_count` changed by >= 3, schema types added. Any hit → one `competitor_change` alert
   (`warning`) whose detail lists the changed facets; deep link
   `/{projectId}/analytics?ws=competitors`. Then store the new scorecard +
   `last_scanned_at`. Crawl/HTTP failure: log and skip (no alert, keep old scorecard).
   Dedupe key: `competitor_change:{url}:{iso_week}`.
3. **Market — Oasis, weekly cron (Monday 07:00 UTC, before the 08:00 digest).** Runs for
   projects with an active GSC connection. Snapshot payload: top queries by impressions
   `{query: impressions}` (top 200). Diff finds **new demand** (queries with impressions
   >= 50 absent from the previous snapshot) and **risers** (impressions at least doubled and
   >= 100). All findings aggregate into **one** `market_shift` alert (`info`) per week listing
   the top 5 (title: count; detail: the list); deep link `/{projectId}/analytics?ws=market`.
   Dedupe key: `market_shift:{iso_week}`.

Weekly crons (`app/workers/tasks/monitoring_tasks.py`): `run_competitor_monitor` and
`run_market_monitor` iterate their eligible projects with per-project try/except (the
autopilot batch pattern), registered in `worker.py`.

## API (`app/api/v1/routers/monitoring.py`)

- `GET  /monitoring/alerts?project_id=&unread_only=&kind=&limit=` → list (newest first,
  default limit 50).
- `POST /monitoring/alerts/{alert_id}/read` → mark read.
- `POST /monitoring/alerts/read-all?project_id=` → mark all read, returns count.
- `GET  /monitoring/alerts/unread-count?project_id=` → `{count}`.
- `GET  /monitoring/competitors?project_id=` / `POST /monitoring/competitors` (project_id,
  url, label — validates URL shape, enforces per-project uniqueness, cap 10 per project) /
  `DELETE /monitoring/competitors/{id}`.
- All org-scoped via the current user, standard 404 on cross-org access.

## Frontend

- **`AlertsBell`** (`components/monitoring/AlertsBell.tsx`) in the TopBar: bell icon +
  unread-count badge (hidden at 0), polls `unread-count` (staleTime 60s). Click → popover
  (`.popover` class) with the 5 newest alerts (agent icon, title, relative time; click = mark
  read + navigate to the alert's deep link) and a "View all" link to the inbox. Resolves the
  current project from the URL path (same pattern as I18nProvider) with store fallback.
- **Alerts inbox** (`app/(dashboard)/[projectId]/alerts/page.tsx`): filters (all/unread; by
  kind), list rows — severity dot (`info`=muted, `warning`=warning, `critical`=destructive),
  the finding agent's icon + name from `lib/agents` (Zerda=rankings, Sable=competitor,
  Oasis=market), title/detail, relative time, deep-link action button, mark-read; "Mark all
  read" header action. Empty state: "The Pack is keeping watch - no alerts yet."
- **`WatchlistCard`** on the inbox page: list of watched competitor URLs with remove, an
  add-URL input (+ optional label), and a hint that Sable re-scans weekly.
- **Digest**: `compose_digest` gains one line — unread alert count for the project — wrapped
  in try/except so digest never breaks on monitoring errors.
- No sidebar item (the bell is the entry point). Full i18n under a new `alertsCenter.*` block
  in all six locales (en/fr/es/de/pt/ar) with native translations and key parity; dates
  formatted with the active locale. NO EMOJI; Tailwind CSS variables only.

## Error handling

- First run per (project, kind) is silent (snapshot only).
- Dedupe uniqueness makes detector re-runs idempotent; insert conflicts are skipped silently.
- Weekly crons isolate failures per project; the ranking detector is try/except-isolated
  inside `_sync_one_project` (never breaks the nightly sync).
- Competitor crawl failures: logged, skipped, old scorecard kept — no alert noise.
- Watchlist POST validates the URL (http/https, hostname) and caps at 10 per project (400
  beyond).
- No GSC → ranking/market detectors simply don't run for that project; empty watchlist → no
  competitor scans. Nothing fabricated.

## Testing

Backend (pytest, SQLite harness pattern from `tests/test_autopilot.py`):
- Rankings: first run silent; drop >= 3 positions with >= 50 impressions alerts (critical
  when off page 1, warning otherwise); gain into top 10 alerts info; below-threshold moves
  are silent; dedupe key blocks a second alert the same week; snapshot overwritten.
- Competitor: scorecard diff triggers on each facet (title, meta, word count 20%, h2 >= 3,
  schema added); unchanged page = no alert; crawl failure = skip + old scorecard kept
  (patch the scan helper); watchlist CRUD incl. uniqueness + cap.
- Market: new-demand + riser detection aggregates into ONE alert with top 5; first run
  silent; weekly dedupe.
- Cron batch isolation (one failing project does not stop others); alerts endpoints
  (list/filter, read, read-all, unread-count, org scoping).
Frontend: `npm run typecheck`; visual pass (bell badge, popover, inbox filters, watchlist,
both themes).

## Reused infrastructure

`GscQueryStat`/GSC sync pipeline (`_sync_one_project` hook point), `competitor_service`
crawler + scorecard, arq cron worker + batch-isolation pattern, `lib/agents` visuals,
`.popover` styling, digest composer, i18n, org-scoped router conventions.
