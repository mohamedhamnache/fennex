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

- Article → `WordPressConnector.publish_post(title, content_html, status, meta_title, meta_description)`
  with creds via `decrypt_credentials(conn.credentials_encrypted)` (`{username, app_password}`);
  article must be `ready`/`published`. Pattern in `app/api/v1/routers/publishing.py::publish_article`.
- Banner (`GeneratedImage`) → `app/services/publish_service.py::publish_to_wordpress(image_url,
  seo_filename, alt_text, wp_url, wp_user, wp_app_password)`. Pattern in `image_publish.py`.
- Social → LinkedIn `ugcPosts` via the org's LinkedIn `SocialConnection`; token/urn from
  `json.loads(decrypt_value(conn.encrypted_token))`. Pattern in `social.py::publish_post`.
- No auto-publish scheduler exists today; social `scheduled_at` is currently inert metadata.

## Data model — `calendar_entries`

New model `app/models/calendar_entry.py` (`Base, TimestampMixin`); Alembic migration. Generic
column types only (SQLite test compatibility).

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
| `target_kind` | str(20) \| null | `"wordpress"` \| `"linkedin"` |
| `connection_id` | UUID \| null | `PublishingConnection` id (WordPress); null for LinkedIn |
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
  unless a valid target is set: `target_kind` present, and for `wordpress` a `connection_id` that
  belongs to the org. Social maps to `linkedin` only (unsupported platforms cannot reach `scheduled`).
- `publishing`: set BEFORE calling the publish service, so overlapping cron runs never double-post.
- `published`: `published_at`/`published_url` set; the underlying content's own status is updated
  (article/social → published).
- `failed`: `error` set; user can retry (UI moves it back to `scheduled`).

## Backend

### Service — `app/services/calendar_service.py`
- `list_entries(project_id, org_id, start_iso, end_iso, db)` — entries whose `scheduled_at` is in range.
- `create_entry(project_id, org_id, data, db)` — validates content exists + belongs to the org,
  snapshots a display `title`, defaults `state="planned"`. Title source per type: article →
  `Article.title`; social → first ~80 chars of `SocialPost.content`; banner → `GeneratedImage.caption`
  or `seo_filename` or first ~60 chars of `prompt`, else "Banner".
- `update_entry(entry_id, org_id, patch, db)` — reschedule / target / state; enforces the
  `scheduled`-requires-valid-target rule; None if not owned.
- `delete_entry(entry_id, org_id, db)`.
- `CalendarError` exception for invalid content / invalid schedule transition.

Publish dispatch lives in `app/services/calendar_publish.py`:
- `publish_entry(entry, db)` — no-op unless armed (`scheduled`/`failed`); sets `publishing`, resolves
  content + connection, dispatches by `content_type`, sets `published` (+ source status) or `failed`.

### API — `app/api/v1/routers/calendar.py` at `/calendar`
`GET ?project_id=&start=&end=`, `POST ?project_id=`, `PATCH /{id}`, `DELETE /{id}`,
`POST /{id}/publish-now`. `CurrentUser`/`DB`, org-scoped. Registered in `router.py`.

### Scheduler — Phase 2, `app/workers/tasks/calendar_tasks.py`
`run_content_scheduler(ctx)` selects `state='scheduled' AND scheduled_at <= utcnow` (limit 50) and
calls `publish_entry` per entry inside try/except. Registered in `worker.py` cron_jobs every 15 min.

## Frontend

- `apps/web/lib/api.ts`: `CalendarEntry` type + `listCalendar`, `createCalendarEntry`,
  `updateCalendarEntry`, `deleteCalendarEntry`, `publishCalendarEntryNow`.
- Page `app/(dashboard)/[projectId]/calendar/page.tsx`: month grid; day cells show entry chips
  colored by `content_type` with a state badge. Sidebar: add `calendar` to `NAV_ITEMS` + each
  persona primary list; `nav.calendar` key.
- `AddToCalendarModal`: pick a schedulable draft (article/social/banner) + date/time + (WP) target
  connection → `createCalendarEntry`.
- `CalendarEntryPopover`: reschedule, set target, toggle Planned↔Scheduled, Publish now, Delete.
- Full i18n; add a `calendar` block to `en/common.json`.

## Timezone

Store `scheduled_at` UTC; capture the creator's browser tz
(`Intl.DateTimeFormat().resolvedOptions().timeZone`) into `timezone`; display converts. Scheduler
compares in UTC.

## Error handling

- Move to `scheduled` without a valid target → 400 / blocked toggle.
- Referenced content deleted before publish → `failed`, "content no longer exists".
- Publish API failure → `failed` + `error`; failed badge on the chip; retry.
- Unsupported social platform (non-LinkedIn) → cannot arm to `scheduled`.
- Missing/expired connection at publish time → `failed` + clear error.

## Testing

Backend (pytest, SQLite harness mirroring `tests/test_recommendations.py`; tables: organizations,
users, projects, articles, social_posts, generated_images, calendar_entries):
- `create_entry` validates content + snapshots title; unknown content → `CalendarError`.
- `update_entry` blocks `planned→scheduled` without a target; allows with one.
- `publish_entry` success (publish paths mocked) → `published` + source status updated; failure →
  `failed` + error; no-op on non-armed state.
- scheduler `publish_due` picks only `scheduled` + due (not future, not planned).
- endpoint tests: create, list-in-range, patch state (400 without target), delete, publish-now.

Frontend: `npm run typecheck`; visual check of grid, add-content modal, entry popover, publish-now.

## Reused infrastructure

- `publish_service.py` (`publish_to_wordpress`); `WordPressConnector`; LinkedIn `ugcPosts`;
  `PublishingConnection` / `PublishJob`; `SocialConnection`.
- arq cron in `app/workers/worker.py`.
- `Card`, i18n, sidebar `NAV_ITEMS`/`personaNav`, TanStack Query.
- Content sources `Article`, `SocialPost`, `GeneratedImage` (read-only from the calendar's view).
