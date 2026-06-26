# Phase 10: Analytics — Design Spec

**Date:** 2026-06-26
**Status:** Approved

---

## Context

Phase 10 adds the Analytics section to Fennex. Phases 0–9 are complete. The analytics router, model file, and page are all stubs. This phase wires them up with a full dashboard: GSC OAuth scaffold, daily sync worker, keyword rankings, traffic charts, top pages/queries, and content performance.

**Key decisions:**
- GSC integration is **mock-first** (consistent with prior phases): OAuth flow is scaffolded, but the sync worker generates heuristic data. Real GSC API calls are a future extension.
- Keyword rankings **reuse the existing `keywords` table** — no separate "tracked keyword" concept.
- Charts use **Recharts** (added to `@fennex/web`).

---

## Data Models

### `analytics_snapshots`

One row per day per project. Stores aggregated GSC-style metrics.

```
id          UUID PK
project_id  UUID FK → projects (CASCADE)
org_id      UUID FK → organizations (CASCADE)
date        DATE NOT NULL
clicks      INTEGER
impressions INTEGER
ctr         FLOAT        -- 0.0–1.0
avg_position FLOAT
UNIQUE(project_id, date)
```

Pre-seeded for 90 days on project creation by `seed_analytics_history` worker task.

### `keyword_rankings`

Daily position snapshot per keyword per project. Reuses keywords from completed research jobs.

```
id          UUID PK
keyword_id  UUID FK → keywords (CASCADE)
project_id  UUID FK → projects (CASCADE)
org_id      UUID FK → organizations (CASCADE)
date        DATE NOT NULL
position    FLOAT        -- lower = better
url         VARCHAR(2048) NULLABLE
UNIQUE(keyword_id, date)
```

### `gsc_connections`

One row per project. Stores OAuth tokens (AES-256 encrypted, same pattern as `api_keys`).

```
id             UUID PK
project_id     UUID FK → projects (CASCADE) UNIQUE
org_id         UUID FK → organizations (CASCADE)
google_email   VARCHAR(255)
access_token   TEXT        -- encrypted
refresh_token  TEXT        -- encrypted
token_expiry   TIMESTAMP
site_url       VARCHAR(2048)
is_active      BOOLEAN DEFAULT FALSE
last_synced_at TIMESTAMP NULLABLE
```

### `Keyword` model extension

`current_position` and `position_change` are **not stored columns** — they are derived at query time by joining the latest `keyword_rankings` row and the row from 7 days prior.

---

## API Layer

Router: `apps/api/app/api/v1/routers/analytics.py` (fully replaced from stub).
Service: `apps/api/app/services/analytics_service.py` (new).
Schemas: `apps/api/app/schemas/analytics.py` (new).

All routes are mounted under `/api/v1/projects/{project_id}/analytics/` via the existing router registration pattern.

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/overview` | 4 summary stats + % change vs prior period |
| `GET` | `/traffic` | `analytics_snapshots` rows; `?range=7d\|28d\|90d` (default 28d) |
| `GET` | `/rankings` | Keywords with position, delta, volume, intent; sortable, paginated |
| `GET` | `/content-performance` | Articles matched to GSC metrics by URL |
| `GET` | `/top-pages` | Top 20 pages by clicks for selected range |
| `GET` | `/top-queries` | Top 20 queries by clicks (from keyword rankings) |
| `POST` | `/gsc/connect` | Returns OAuth2 redirect URL |
| `GET` | `/gsc/callback` | Handles OAuth2 callback; stores tokens; triggers initial seed |
| `DELETE` | `/gsc/disconnect` | Removes GSC connection |
| `GET` | `/gsc/status` | Connection status + last sync time |

### Schemas (`schemas/analytics.py`)

- `AnalyticsOverview` — `{ clicks, impressions, ctr, avg_position, clicks_change, impressions_change, ctr_change, position_change }`
- `TrafficDataPoint` — `{ date, clicks, impressions, ctr, avg_position }`
- `RankingRow` — `{ keyword_id, keyword, search_volume, intent, difficulty, current_position, position_change }`
- `ContentPerformanceRow` — `{ article_id, title, published_url, published_at, clicks, impressions, ctr }` — metrics aggregated from `keyword_rankings` rows where `url` matches `article.published_url`
- `TopPageRow` — `{ url, clicks, impressions, ctr, avg_position }`
- `TopQueryRow` — `{ query, clicks, impressions, ctr, avg_position }`
- `GscConnectionStatus` — `{ is_connected, google_email, site_url, last_synced_at }`

### RBAC

All `GET` endpoints: `viewer` and above. GSC connect/disconnect: `admin` and above.

---

## Background Workers

File: `apps/api/app/workers/tasks/analytics_tasks.py` (new).

### `seed_analytics_history(project_id)`

Triggered once from the project creation endpoint (alongside existing crawl seed calls). Writes 90 days of backward-looking mock data:

- `analytics_snapshots`: base clicks derived from sum of keyword search volumes × 0.02 CTR estimate, ±20% daily variance; impressions = clicks × random(8–15); position = avg keyword difficulty inverted (difficulty 80 → position ~8, difficulty 20 → position ~2)
- `keyword_rankings`: one row per keyword per day from all completed research jobs on the project; position = inverted difficulty + random drift ±2 per day

### `sync_analytics_data(project_id)`

Called daily at 06:00 UTC via ARQ cron (added to `WorkerSettings` in `worker.py`).

1. Load `gsc_connections` for project
2. If `is_active = True` and not dev mode: call GSC Search Analytics API for yesterday, write real row
3. Otherwise: generate one heuristic `analytics_snapshots` row and one `keyword_rankings` row per keyword using the same mock logic as `seed_analytics_history`
4. Update `last_synced_at` on the connection record

### Worker registration

`worker.py` additions:
```python
from app.workers.tasks.analytics_tasks import sync_analytics_data, seed_analytics_history

# In cron_jobs list:
cron(sync_analytics_data, hour=6, minute=0)
```

---

## Frontend

**File:** `apps/web/app/(dashboard)/[projectId]/analytics/page.tsx` (full replacement).
**New dependency:** `recharts` added to `apps/web/package.json`.
**API client additions:** `apps/web/lib/api.ts` extended with all analytics fetch functions.

### Page structure

```
<AnalyticsPage>
  <GscBanner />                  ← connect/status bar, always visible
  <DateRangePicker />             ← 7d / 28d / 90d; shared via useState
  <Tabs defaultValue="overview">
    <TabsList> Overview | Rankings | Pages & Queries | Content </TabsList>
    <TabsContent value="overview">   <OverviewTab /> </TabsContent>
    <TabsContent value="rankings">   <RankingsTab /> </TabsContent>
    <TabsContent value="pages">      <PagesQueriesTab /> </TabsContent>
    <TabsContent value="content">    <ContentPerformanceTab /> </TabsContent>
  </Tabs>
</AnalyticsPage>
```

### GscBanner

- Not connected: info banner "Connect Google Search Console for real data" + Connect button → calls `connectGsc()` → redirects to OAuth URL
- Connected: subtle status line showing Google email, site URL, last sync time, Disconnect link

### OverviewTab

- 4 stat cards: **Clicks**, **Impressions**, **Avg CTR**, **Avg Position** — period totals + colored delta (green/red arrows)
- `<AreaChart>` (Recharts `ResponsiveContainer` + `AreaChart`) — dual-area: clicks (primary color) and impressions (muted) over selected date range; x-axis formatted as "MMM d"; tooltip shows all 4 metrics for hovered date

### RankingsTab

- Table: Keyword | Volume | Intent (badge) | Difficulty (bar) | Position | Change (±Δ with arrow icon)
- Default sort: position ascending; reuses `DifficultyBar` and `IntentBadge` components from the keywords page
- Paginated: 25 rows per page

### PagesQueriesTab

- Two side-by-side tables (stacked on mobile): **Top Pages** and **Top Queries**
- Columns: URL/Query | Clicks | Impressions | CTR | Avg Position
- Top 20 rows each, no pagination

### ContentPerformanceTab

- Table: Article Title | Published Date | Clicks | Impressions | CTR
- Articles without a `published_url` show a "Not published" muted badge and zero metrics
- Empty state: FennecMascot with "Publish articles to see their performance"

### TanStack Query keys & stale times

- `['analytics', 'overview', projectId, range]` — 5 min stale
- `['analytics', 'traffic', projectId, range]` — 5 min stale
- `['analytics', 'rankings', projectId, page, sort]` — 5 min stale
- `['analytics', 'gsc-status', projectId]` — 30 s stale (connection check)

---

## Migration

New Alembic migration creates `analytics_snapshots`, `keyword_rankings`, `gsc_connections` tables and adds appropriate indexes:

```sql
CREATE INDEX ix_analytics_snapshots_project_date ON analytics_snapshots(project_id, date DESC);
CREATE INDEX ix_keyword_rankings_keyword_date ON keyword_rankings(keyword_id, date DESC);
CREATE INDEX ix_keyword_rankings_project_date ON keyword_rankings(project_id, date DESC);
```

---

## Out of Scope

- Real Google OAuth client credentials setup (requires Google Cloud project; documented as a future step)
- DataForSEO rank checking integration (Phase 3 extension)
- Alerts / threshold notifications (Phase 12)
- Custom date range picker beyond 7d / 28d / 90d presets
