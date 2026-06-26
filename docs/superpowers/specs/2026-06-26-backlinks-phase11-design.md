# Phase 11: Backlinks Implementation Plan

**Date:** 2026-06-26
**Status:** Approved

---

## Context

Phase 11 adds a full backlink feature to Fennex. The backlinks router and page are both stubs. This phase wires them up with two distinct capabilities:

1. **Backlink Monitor + Opportunity Finder** — fetch the project's existing backlinks via DataForSEO, score domains, filter spam, discover link gap opportunities vs competitors.
2. **Exchange Marketplace** — Fennex users can list their sites as open to link exchanges, discover other listings, send/receive exchange requests with full message threads, and verify live links via the existing crawler service.

**Key decisions:**
- Single `backlinks` router (Option A) — sub-features as nested paths, consistent with all other feature areas.
- Domain scoring: DataForSEO authority/trust data + lightweight heuristic spam filter (no custom crawl scorer).
- Exchange link verification reuses the existing crawler service (`CRAWLER_SERVICE_URL`).
- Mock-first: DataForSEO calls fall back to mock provider when no key is configured, same as Phase 3.

---

## Data Models

### `backlink_profiles`

One row per project. Upserted on each DataForSEO sync.

```
id             UUID PK
project_id     UUID FK → projects UNIQUE (CASCADE)
org_id         UUID FK → organizations (CASCADE)
domain         VARCHAR(255)
total_backlinks INTEGER DEFAULT 0
domain_authority FLOAT
trust_score    FLOAT
spam_score     FLOAT
referring_domains INTEGER DEFAULT 0
last_synced_at TIMESTAMPTZ NULLABLE
```

### `backlinks`

Individual backlink rows. Upserted by source_url per sync.

```
id             UUID PK
profile_id     UUID FK → backlink_profiles (CASCADE)
project_id     UUID FK → projects (CASCADE)
org_id         UUID FK → organizations (CASCADE)
source_url     VARCHAR(2048)
source_domain  VARCHAR(255)
target_url     VARCHAR(2048)
anchor_text    VARCHAR(500)
domain_authority FLOAT
trust_score    FLOAT
spam_score     FLOAT
is_spam        BOOLEAN DEFAULT FALSE
link_type      VARCHAR(20)   -- 'dofollow' | 'nofollow'
first_seen     DATE
last_seen      DATE
UNIQUE(project_id, source_url)
```

### `backlink_opportunities`

Domains that link to competitors but not to the project.

```
id             UUID PK
project_id     UUID FK → projects (CASCADE)
org_id         UUID FK → organizations (CASCADE)
source_domain  VARCHAR(255)
source_url     VARCHAR(2048)
domain_authority FLOAT
trust_score    FLOAT
spam_score     FLOAT
is_spam        BOOLEAN DEFAULT FALSE
linking_to_competitor VARCHAR(255)
status         VARCHAR(20) DEFAULT 'new'  -- new/contacted/won/lost/ignored
UNIQUE(project_id, source_url)
```

### `exchange_listings`

One row per project that opts into the exchange board.

```
id             UUID PK
project_id     UUID FK → projects UNIQUE (CASCADE)
org_id         UUID FK → organizations (CASCADE)
site_url       VARCHAR(2048)
niche          VARCHAR(100)
language       VARCHAR(10)
domain_authority FLOAT
description    TEXT
is_active      BOOLEAN DEFAULT TRUE
```

### `exchange_requests`

One per pair of projects.

```
id                       UUID PK
requester_project_id     UUID FK → projects (CASCADE)
target_project_id        UUID FK → projects (CASCADE)
requester_org_id         UUID FK → organizations (CASCADE)
target_org_id            UUID FK → organizations (CASCADE)
status                   VARCHAR(20) DEFAULT 'pending'  -- pending/accepted/live/rejected/cancelled
requester_url            VARCHAR(2048)   -- URL where requester will place the link
target_url               VARCHAR(2048)   -- URL where target will place the link
requester_link_verified  BOOLEAN DEFAULT FALSE
target_link_verified     BOOLEAN DEFAULT FALSE
UNIQUE(requester_project_id, target_project_id)
```

### `exchange_messages`

Thread per exchange request.

```
id             UUID PK
request_id     UUID FK → exchange_requests (CASCADE)
sender_org_id  UUID FK → organizations (CASCADE)
body           TEXT NOT NULL
created_at     TIMESTAMPTZ DEFAULT now()
```

---

## API Layer

Router: `apps/api/app/api/v1/routers/backlinks.py` (full replacement).
Service: `apps/api/app/services/backlinks_service.py` (new).
Schemas: `apps/api/app/schemas/backlinks.py` (new).

All routes mounted at `/api/v1/backlinks/`.

### Backlink Profile + Opportunities

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/backlinks/profile` | `?project_id=` — domain authority, trust score, totals |
| `POST` | `/backlinks/analyze` | Enqueue DataForSEO sync job; returns `202 { job_id }` |
| `GET` | `/backlinks` | `?project_id=&is_spam=&page=` — paginated backlink list |
| `GET` | `/backlinks/opportunities` | `?project_id=&status=` — opportunity list, filterable |
| `PATCH` | `/backlinks/opportunities/{id}` | Update opportunity status |

### Exchange Marketplace

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/backlinks/exchange/board` | All active listings; `?niche=&language=` |
| `GET` | `/backlinks/exchange/listing` | `?project_id=` — own listing or 404 |
| `POST` | `/backlinks/exchange/listing` | Create or update own listing |
| `DELETE` | `/backlinks/exchange/listing` | `?project_id=` — deactivate listing |
| `GET` | `/backlinks/exchange/requests` | `?project_id=&role=sent\|received` |
| `POST` | `/backlinks/exchange/requests` | Send exchange request |
| `PATCH` | `/backlinks/exchange/requests/{id}` | Accept / reject / cancel |
| `POST` | `/backlinks/exchange/requests/{id}/verify` | Trigger link verification; `?side=requester\|target` |
| `GET` | `/backlinks/exchange/requests/{id}/messages` | Message thread |
| `POST` | `/backlinks/exchange/requests/{id}/messages` | Send message |

### Schemas (`schemas/backlinks.py`)

- `BacklinkProfileOut` — all `backlink_profiles` fields
- `BacklinkOut` — all `backlinks` fields
- `BacklinkOpportunityOut` + `OpportunityStatusUpdate` — `{ status: str }`
- `ExchangeListingOut` + `ExchangeListingCreate` — `{ site_url, niche, language, domain_authority, description }`
- `ExchangeRequestOut` + `ExchangeRequestCreate` — `{ target_project_id, requester_url, target_url, initial_message? }`
- `ExchangeRequestUpdate` — `{ status: str }`
- `ExchangeMessageOut` + `ExchangeMessageCreate` — `{ body: str }`
- `AnalyzeResponse` — `{ job_id: str, status: str }`

### RBAC

All reads: `viewer` and above. Write operations (analyze, listing CRUD, exchange requests, messages): `seo_manager` and above.

---

## Background Workers

File: `apps/api/app/workers/tasks/backlink_tasks.py` (new).

### `sync_backlink_profile(ctx, project_id: str)`

Triggered by `POST /backlinks/analyze`. Uses the existing `get_seo_provider()` from `app.integrations.seo_apis` (DataForSEO or mock).

1. Load project domain from `projects` table
2. Call `provider.get_backlink_profile(domain)` → returns domain authority, trust score, total backlinks, referring domains
3. Upsert `backlink_profiles`
4. Call `provider.get_backlinks(domain)` → list of backlink rows
5. For each: run `_is_spam(backlink)` heuristic, upsert into `backlinks`
6. Call `provider.get_backlink_opportunities(domain)` → competitor gap domains
7. For each: run `_is_spam`, upsert into `backlink_opportunities`

### `verify_exchange_link(ctx, request_id: str, side: str)`

Triggered by `POST /exchange/requests/{id}/verify?side=requester|target`.

1. Load exchange request from DB
2. Determine URL to check (requester_url if side=requester, target_url if side=target)
3. Determine domain to look for (the counterpart's site_url from their exchange listing)
4. POST to `CRAWLER_SERVICE_URL/fetch` with the URL
5. Parse response outbound links; check if counterpart domain appears
6. Update `requester_link_verified` or `target_link_verified`; if both true → set status to `live`

### `weekly_backlink_discovery(ctx)`

ARQ cron, every Monday 07:00 UTC. Queries all `backlink_profiles` rows; enqueues `sync_backlink_profile` for each.

### Spam heuristic (`_is_spam(domain, da, trust, anchor_text) -> bool`)

```python
SPAM_TLDS = {'.xyz', '.top', '.click', '.loan', '.gq', '.tk', '.ml', '.ga', '.cf'}
SPAM_KEYWORDS = {'casino', 'pharma', 'adult', 'dating', 'poker', 'viagra'}

def _is_spam(domain: str, da: float | None) -> bool:
    tld = '.' + domain.rsplit('.', 1)[-1].lower()
    if tld in SPAM_TLDS:
        return True
    if any(kw in domain.lower() for kw in SPAM_KEYWORDS):
        return True
    if da is not None and da < 5:
        return True
    return False
```

Per-backlink spam flag uses `_is_spam(domain, da)` only. Anchor text stuffing check (>60% exact-match commercial keywords across all anchors for a domain) is a separate profile-level metric stored in `backlink_profiles.spam_score` — not a per-row flag.

### Worker registration

`worker.py` additions:
```python
from app.workers.tasks.backlink_tasks import sync_backlink_profile, verify_exchange_link, weekly_backlink_discovery

# functions list: add sync_backlink_profile, verify_exchange_link, weekly_backlink_discovery
# cron_jobs list: add cron(weekly_backlink_discovery, weekday=0, hour=7, minute=0)
```

---

## Frontend

**File:** `apps/web/app/(dashboard)/[projectId]/backlinks/page.tsx` (full replacement).
**API client additions:** `apps/web/lib/api.ts` — 14 new functions.

### Page structure

```
<BacklinksPage>
  <Tabs defaultValue="profile">
    Profile | Backlinks | Opportunities | Exchange
  </Tabs>
</BacklinksPage>
```

### Profile tab

- 5 stat cards: Total Backlinks, Referring Domains, Domain Authority, Trust Score, Spam Score
- "Analyze" button → `POST /backlinks/analyze` → polls job status with TanStack Query refetchInterval
- Last synced timestamp below cards
- Empty state: FennecMascot + "Run your first backlink analysis"
- In-progress state: spinner overlay on cards with "Syncing…"

### Backlinks tab

- Paginated table (25/page): Source Domain | Anchor Text | DA | Trust | Link Type badge | Spam warning icon
- "Hide spam" toggle (default on); filters `is_spam=false`
- Row click opens source URL in new tab
- Empty state: FennecMascot + "No backlinks found yet"

### Opportunities tab

- Table sorted by DA descending: Domain | DA | Trust | Links To | Status
- Status rendered as an inline `<select>` dropdown (new/contacted/won/lost/ignored); change calls `PATCH /backlinks/opportunities/{id}`
- Color-coded badges per status
- "Show spam" toggle (default off)

### Exchange tab

**Listing panel** (top of tab, always visible):
- If no listing: CTA form with fields (site URL, niche, description, language, DA) + "List My Site" button
- If listing exists: edit form + active/inactive toggle + "Save" button

**Board / My Requests toggle** (button group below listing panel):

**Board view:**
- Cards grid: site URL, niche, language, DA chip — filtered by niche/language dropdowns
- "Request Exchange" button on each card → modal with two fields (requester URL, initial message) + Send button
- Own project's listing card is not shown on the board

**My Requests view:**
- Tabs: Sent | Received
- Each request card: counterpart domain, status badge, link verification row (✓ Verified / ⚠ Unverified + "Verify" button per side)
- Click card to expand inline message thread
- Thread: chat bubbles (own messages right-aligned, counterpart left-aligned), timestamps
- Message input + Send button at bottom of thread
- "Accept" / "Reject" action buttons visible on Received requests in pending status

### TanStack Query keys

- `['backlinks', 'profile', projectId]` — 5 min stale
- `['backlinks', 'list', projectId, page, showSpam]` — 5 min stale
- `['backlinks', 'opportunities', projectId, status]` — 5 min stale
- `['backlinks', 'exchange', 'board', niche, language]` — 2 min stale
- `['backlinks', 'exchange', 'requests', projectId, role]` — 30 s stale
- `['backlinks', 'exchange', 'messages', requestId]` — 15 s stale (active thread)

---

## Migrations

New Alembic migration `g2b3c4d5e6f7_phase11_backlink_models.py` (down_revision: `f1a2b3c4d5e6`).

Creates: `backlink_profiles`, `backlinks`, `backlink_opportunities`, `exchange_listings`, `exchange_requests`, `exchange_messages`.

Key indexes:
```sql
CREATE INDEX ix_backlinks_project_id ON backlinks(project_id);
CREATE INDEX ix_backlinks_is_spam ON backlinks(project_id, is_spam);
CREATE INDEX ix_backlink_opportunities_project_status ON backlink_opportunities(project_id, status);
CREATE INDEX ix_exchange_requests_requester ON exchange_requests(requester_project_id);
CREATE INDEX ix_exchange_requests_target ON exchange_requests(target_project_id);
CREATE INDEX ix_exchange_messages_request ON exchange_messages(request_id, created_at);
```

---

## DataForSEO Mock Provider Extensions

`app/integrations/seo_apis/mock_provider.py` needs three new methods:
- `get_backlink_profile(domain)` → returns mock domain metrics
- `get_backlinks(domain)` → returns 20 mock backlink rows
- `get_backlink_opportunities(domain)` → returns 10 mock opportunity rows

The `SEODataProvider` Protocol in `base.py` gets the same three method signatures.

---

## Out of Scope

- Real DataForSEO backlink API call format (mocked in this phase; real implementation follows same pattern as keyword provider)
- Email notifications for exchange request updates (Phase 12)
- Escrow or payment for link exchanges
- Automated link monitoring (re-verify live exchanges on a schedule)
