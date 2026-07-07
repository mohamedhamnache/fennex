# Unified Content Calendar + Auto-Publish — Design Spec

Date: 2026-07-07
Feature #4 from `docs/superpowers/plans/2026-07-05-fennex-coherence-and-differentiation.md`.

## Purpose

Turn Fennex's separate content tools (articles, social posts, marketing banners) into one
workflow: a single calendar where every piece of content is planned on a date, and — when the
user explicitly schedules it — published automatically at its scheduled time via the existing
publish integrations. Closes the "point tools, no workflow" gap in the coherence roadmap.

## Scope

- A unified month/week **calendar** across three content types: article, social post, banner
  (a `GeneratedImage` with a `banner_format`).
- A **scheduling authority** — one `CalendarEntry` table holding the planned time, target, and
  state — so the three content models stay untouched.
- **Auto-publish** at scheduled time via a scheduler cron, using existing publish services.
  v1 targets (the paths that actually exist): **article → WordPress** (`WordPressConnector`),
  **banner → WordPress** (`publish_to_wordpress`), **social → LinkedIn** (`ugcPosts`). Shopify is
  DEFERRED — article→Shopify is unimplemented, and banner→Shopify uses a different credential source
  (an `APIKey`, not a `PublishingConnection`); both are follow-ups. So `target_kind` in v1 is
  `wordpress` | `linkedin`.
- **Safety gate:** only items explicitly moved to the `scheduled` state (with a valid target)
  auto-publish. Drafts placed on the calendar never post themselves.

Phasing (one spec, two independently shippable phases in the plan):
- **Phase 1** — `CalendarEntry` model + service + API + calendar UI + content picker + manual
  "Publish now". Fully usable without any cron.
- **Phase 2** — the `run_content_scheduler` arq cron that auto-publishes due `scheduled` entries.

Out of scope: auto-publish for social platforms other than LinkedIn (twitter/instagram/facebook
publishing is not wired — those entries can be `planned` but are blocked from `scheduled`);
recurring/repeating schedules; multi-user approval workflow; drag-and-drop reschedule (click-to-edit
date/time in v1; drag is a later enhancement).

## Real publish paths reused (verified)

- Article → `app/services/publish_service.py`: `publish_to_wordpress`, `publish_to_shopify`.
- Banner (`GeneratedImage`) → `app/api/v1/routers/image_publish.py` (`publish_to_wordpress/shopify`).
- Social → LinkedIn `ugcPosts` via the OAuth connection (`app/api/v1/routers/social.py`).
- No auto-publish scheduler exists today; social `scheduled_at` is currently inert metadata.

## Data model — `calendar_entries`

New model `app/models/calendar_entry.py` (`Base, TimestampMixin`); Alembic migration. Use generic
`sqlalchemy.JSON` if any JSON is needed (SQLite test compatibility) — none required here.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID pk | |
| `org_id` | UUID fk organizations | cascade |
| `project_id` | UUID fk projects | cascade |
| `content_type` | str(20) | `"article"` \| `"social"` \| `"banner"` |
| `content_id` | UUID | id in the source table; validated at schedule + publish time (no FK) |
| `title` | str(500) | denormalized snapshot for calendar display |
| `scheduled_at` | str(50) | ISO-8601 UTC planned publish time |
| `timezone` | str(64) | IANA tz for display (creator's browser tz; default "UTC") |
| `target_kind` | str(20) \| null | `"wordpress"` \| `"shopify"` \| `"linkedin"` |
| `connection_id` | UUID \| null | `PublishingConnection` id (WP/Shopify); null for LinkedIn |
| `state` | str(20) | `planned` \| `scheduled` \| `publishing` \| `published` \| `failed` |
| `error` | Text \| null | last publish error |
| `published_at` | str(50) \| null | ISO timestamp on success |
| `published_url` | str(500) \| null | live URL on success |
| `created_at, updated_at` | via TimestampMixin | |

Index on `(project_id)` and on `(state, scheduled_at)` for the scheduler due-query.

## Lifecycle & auto-publish gate

`planned` → `scheduled` → `publishing` → `published` \| `failed`.

- `planned`: on the calendar with a date, not armed to publish.
- `scheduled`: **the only state the scheduler publishes.** Transition to `scheduled` is rejected
  unless a valid target is set: `target_kind` present, and for `wordpress`/`shopify` a
  `connection_id` that belongs to the org. Social maps to `linkedin` only (unsupported platforms
  cannot reach `scheduled`).
- `publishing`: set by the scheduler (or Publish-now) BEFORE calling the publish service, so
  overlapping cron runs never double-post.
- `published`: `published_at`/`published_url` set; the underlying content's own status is updated
  (article/social → published).
- `failed`: `error` set; user can retry (UI moves it back to `scheduled`).

## Backend

### Service — `app/services/calendar_service.py`
- `list_entries(project_id, org_id, start_iso, end_iso, db) -> list[CalendarEntry]` — entries whose
  `scheduled_at` falls in `[start, end]`.
- `create_entry(project_id, org_id, data, db) -> CalendarEntry` — validates the referenced content
  exists and belongs to the org, snapshots a display `title`, defaults `state="planned"`. Title
  source per type: article → `Article.title`; social → first ~80 chars of `SocialPost.content`;
  banner → `GeneratedImage.caption` or `seo_filename` or first ~60 chars of `prompt`, else "Banner".
- `update_entry(entry_id, org_id, patch, db) -> CalendarEntry | None` — reschedule / change target /
  change state; enforces the `scheduled`-requires-valid-target rule; returns None if not owned.
- `delete_entry(entry_id, org_id, db) -> bool`.
- `publish_entry(entry, db) -> CalendarEntry` — the dispatch core (reused by cron and Publish-now):
  set `publishing`; resolve content + connection; dispatch by `content_type`; on success set
  `published` (+ update source status), on failure set `failed` + `error`. Idempotent: a no-op if
  the entry is not currently `scheduled`/`failed` (guards against double dispatch).

### API — `app/api/v1/routers/calendar.py` at `/calendar`
- `GET  /calendar?project_id=&start=&end=` → entries in range.
- `POST /calendar?project_id=` → create (schedule content onto the calendar).
- `PATCH /calendar/{entry_id}` → reschedule / state / target.
- `DELETE /calendar/{entry_id}`.
- `POST /calendar/{entry_id}/publish-now` → immediate `publish_entry`.
All use `CurrentUser`/`DB`, org-scoped via `current_user.org_id`. Registered in `router.py` at
prefix `/calendar`.

### Scheduler — Phase 2, `app/workers/tasks/calendar_tasks.py`
- `run_content_scheduler(ctx)`: select `CalendarEntry` where `state='scheduled'` and
  `scheduled_at <= utcnow` (limit e.g. 50); call `publish_entry` on each inside try/except so one
  failure never blocks the batch.
- Register in `app/workers/worker.py`: add to `functions` and `cron_jobs` as
  `cron(run_content_scheduler, minute={0, 15, 30, 45})` (every 15 min).

## Frontend

### API client — `apps/web/lib/api.ts`
`CalendarEntry` type + `listCalendar(projectId, start, end)`, `createCalendarEntry(projectId, body)`,
`updateCalendarEntry(id, patch)`, `deleteCalendarEntry(id)`, `publishCalendarEntryNow(id)`.

### Page — `apps/web/app/(dashboard)/[projectId]/calendar/page.tsx`
- Month/week toggle grid. Each day cell renders entry chips colored by `content_type` (article /
  social / banner) with a small state badge (Planned / Scheduled / Published / Failed).
- **Add content** (`AddToCalendarModal`): lists schedulable drafts — draft articles, draft social
  posts, banners — pick one + date/time + (for WP/Shopify) a target connection → `createCalendarEntry`.
- **Entry popover** (`CalendarEntryPopover`): reschedule date/time, choose target connection,
  toggle Planned↔Scheduled (blocked without a valid target), **Publish now**, Delete.
- Sidebar: add `calendar` to `NAV_ITEMS` and each persona's primary list in `personaNav`; add the
  `nav.calendar` key. New page shown for all personas.

### i18n
Full i18n (project convention): all new user-visible strings via `t()`; add a `calendar` key block
to `apps/web/public/locales/en/common.json` (day/week/month labels, states, add-content, publish-now,
delete, empty states, target labels). Other locales fall back to `en`.

## Timezone

Store `scheduled_at` as ISO-8601 UTC. On create, capture the creator's browser timezone
(`Intl.DateTimeFormat().resolvedOptions().timeZone`) into `timezone`; the calendar displays times
converted to that tz. The scheduler compares in UTC. No server-side tz math beyond UTC comparison.

## Error handling

- Move to `scheduled` without a valid target → 400 (API) / blocked toggle (UI).
- Referenced content deleted before publish → `publish_entry` sets `failed`, error "content no
  longer exists"; the source-status update is skipped.
- Publish API failure → `failed` + `error`; the calendar chip shows a failed badge; retry available.
- Unsupported social platform (non-LinkedIn) → cannot be armed to `scheduled` (validation).
- Missing/expired publish connection at publish time → `failed` + a clear error.

## Testing

Backend (pytest, SQLite harness mirroring `tests/test_recommendations.py`; tables: organizations,
users, projects, articles, social_posts, generated_images, calendar_entries):
- `create_entry` validates content existence + snapshots title; unknown content → error.
- `update_entry` blocks `planned→scheduled` without a valid target; allows with one.
- `publish_entry` success path with the publish services mocked → `state=published`,
  `published_at` set, source content status updated.
- `publish_entry` failure (mock raises) → `state=failed`, `error` set.
- scheduler (`run_content_scheduler`) picks only `scheduled` + due entries, skips `publishing`
  (idempotency) and future-dated ones.
- endpoint tests: create, list-in-range, patch state, publish-now, delete (200/permission scoping).

Frontend: `npm run typecheck`; visual check of month/week grid, add-content modal, entry popover,
and a manual Publish-now.

## Reused infrastructure

- `publish_service.py` (`publish_to_wordpress`, `publish_to_shopify`); `image_publish` path;
  LinkedIn publish (social router); `PublishingConnection` / `PublishRecord` / `PublishJob`.
- arq cron in `app/workers/worker.py`.
- `Card`, i18n, sidebar `NAV_ITEMS`/`personaNav`, TanStack Query.
- Content sources: `Article`, `SocialPost`, `GeneratedImage` (read-only from the calendar's view).
