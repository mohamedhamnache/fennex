# SERP Intelligence (E1) — Design Spec

Date: 2026-07-10
Sub-project E1 of the Fennex next-chapter program (E = sophisticated SEO analysis, split E1/E2).
E1 = SERP keyword tracking + content optimization scoring. E2 (site architecture audit +
competitor domain intel) follows separately on the same provider plumbing.

DEPENDENCY: builds on the monitoring/alerts feature (branch `feat/monitoring-alerts` —
alert engine, alerts inbox). Merge that branch first; E1 work branches from it or from main
after merge.

## Purpose

Give Fennex the two features users compare SEO tools on: real Google rank tracking (not just
GSC averages) and Surfer-class content scoring against the live top-10 — key-gated on the
org's own DataForSEO account, never fabricated, and wired into the existing loop (alerts
inbox, article editor, opportunities).

## Decisions (locked during brainstorming)

- Part of program sub-project E; all four SEO pillars wanted overall; E split E1/E2 (approach 1).
- Data source: **DataForSEO, key-gated per org** (like AI keys). No key → honest "connect your
  SEO data provider" state. Existing mock provider is never shown in the product.
- Cost control: **25 tracked keywords per project**, one SERP snapshot per keyword per day,
  content-score SERP fetches cached 7 days per (keyword, language, location).
- Surfaces: new **SEO hub** page `/[projectId]/seo` + an **Optimize panel in the article
  editor**. Pack attribution: Zerda fronts the tracker, Dune the optimizer.

## Provider layer

- Settings → AI Keys section gains a **DataForSEO card**: provider id `"dataforseo"`, the value
  entered as two fields (login + password) and stored as `login:password` in the existing
  encrypted `APIKey` row (provider column is a free string — no schema change).
- `app/integrations/seo_apis/__init__.py` gains `async get_seo_provider_for_org(org_id, db)
  -> DataForSEOProvider | None`: org APIKey `"dataforseo"` → real provider with those
  credentials; else env `DATAFORSEO_LOGIN/PASSWORD` (dev convenience) → real provider; else
  **None**. The mock provider remains for tests only.
- `DataForSEOProvider` gains a `serp(keyword, language_code, location_code) -> dict` method
  calling `/v3/serp/google/organic/live/regular` (top 100 items incl. rank, url, domain,
  title + SERP feature item types). Language from `project.locale`; location resolved from
  `project.target_country` via a small static country→location_code map (default 2250 France
  when locale is fr and no country, else 2840 US).

## Backend

### Models (one migration)
- **`tracked_keywords`** — id, org_id, project_id, keyword (String 500), language (String 10),
  location_code (Integer), is_active (Boolean default true) + timestamps.
  Unique (project_id, keyword). Cap 25 active per project enforced in the API.
- **`serp_snapshots`** — id, org_id, project_id, tracked_keyword_id (FK cascade), date (Date),
  position (Float nullable — null when not in top 100), url (String 2048 nullable — your
  ranking URL), top10 (JSON: list of {rank, domain, url, title}), features (JSON: list of
  SERP feature types) + timestamps. Unique (tracked_keyword_id, date).

### Services
- **`serp_service`** — provider resolution + `fetch_serp(project, keyword, db) -> dict`
  normalizing the provider payload to {position, url, top10, features} for the project's
  domain (match by registrable domain, first occurrence). 7-day in-DB cache for
  content-scoring fetches reuses the latest `SerpSnapshot` when the keyword is tracked.
- **`rank_tracking_service`** — add/remove/list tracked keywords (cap + dedupe enforced),
  `snapshot_keyword` (fetch, store snapshot idempotently per day), `snapshot_project`,
  history queries (30/90 days), delta computation (1d/7d/30d).
- **`content_scoring_service`** — `score_content(project, keyword, *, article_id | url | raw
  text, db) -> dict`:
  1. SERP top-10 via `serp_service` (or latest snapshot).
  2. Crawl up to top 5 organic result pages via the existing crawler service
     (`CRAWLER_SERVICE_URL /crawl`), extract text/headings; skip failures.
  3. Deterministic analysis: term/phrase coverage (top TF terms of the corpus vs the
     content, stopword-filtered per language), word count vs SERP median, heading count
     targets, questions found in PAA/headings.
  4. One locale-aware LLM call (org AI key, existing `call_llm` with locale) producing a
     prioritized brief; without an AI key the deterministic parts still return and the brief
     is empty.
  Returns {score 0-100, terms: [{term, status: present|underused|missing, count, target}],
  structure: {word_count, target_words, headings, target_headings}, questions: [...],
  brief: str | null, serp_median_words}. No persistence of scores in v1: recomputed on
  demand; the expensive SERP part is cached via snapshots (7 days), crawls are per-request.

### Cron + alerts
- **`run_rank_tracker`** daily 05:30 UTC (before the 06:00 analytics sync): projects having a
  provider AND >= 1 active tracked keyword; per-project try/except isolation; snapshots each
  keyword once (idempotent per (keyword, date)).
- After snapshotting a project, diff vs the previous snapshot per keyword and emit alerts via
  the existing monitoring engine (`_create_alert`): kinds **`serp_drop`** / **`serp_gain`**;
  thresholds: position worsened/improved >= 3.0 (null→ranked counts as gain from 100);
  severity critical when it falls out of the top 10 (was <= 10, now > 10 or null), else
  warning; gains info. Dedupe key `serp_drop:{keyword}:{iso_week}` (same ISO-week rule).
  First-ever snapshot per keyword is baseline — no alert. Alerts deep-link to
  `/{projectId}/seo`. The alerts UI's kind→agent map gains both kinds → zerda.

### Router `/seo`
- `GET /seo/provider-status?project_id=` → {connected: bool, source: "org" | "env" | null}.
- `GET /seo/keywords?project_id=` → tracked keywords with latest position, deltas (1d/7d/30d),
  best URL, features, 30-day sparkline positions.
- `POST /seo/keywords` {project_id, keyword} → 201; 400 over cap or blank; 409 duplicate;
  404 foreign project (ownership guard, same as monitoring watchlist).
- `DELETE /seo/keywords/{id}`; `POST /seo/keywords/{id}/refresh` (on-demand snapshot,
  provider-gated).
- `GET /seo/keywords/{id}/history?days=90` → snapshots for the chart + latest top10/features.
- `POST /seo/score` {project_id, keyword, article_id? , url?, text?} → the scoring payload
  (422 if none of article_id/url/text; provider-gated 409 with a "connect provider" code).
- All org-scoped; project-ownership guard on writes.

## Frontend

- **SEO hub** `app/(dashboard)/[projectId]/seo/page.tsx` + `components/seo/`:
  - Provider not connected → hero empty state (what the tracker does + "Connect DataForSEO"
    → `/settings` deep link).
  - **RankTrackerTable**: keyword, position (with null = "not in top 100"), delta chips
    (7d/30d, green/red), best URL (truncated), feature badges, 30-day sparkline; row click →
    **KeywordDrawer**: 90-day position chart (recharts, like existing analytics charts),
    top-10 list highlighting your domain, features, remove + refresh actions.
  - **AddKeywordBar**: input + add (cap message at 25); suggestions from existing keyword
    research and current GSC top queries (one-click add).
  - **ContentScoreCard**: keyword + (URL or paste text) → score result view (ring, term
    checklist grouped present/underused/missing, structure targets, questions, brief).
- **Article editor Optimize tab** (`components/seo/OptimizePanel.tsx`, mounted in the editor's
  right side next to the existing SEO meta panel): uses the article's `target_keyword`
  (editable), calls `/seo/score` with article_id, renders the same score view compactly,
  re-score button; provider-gate state inline.
- **Sidebar**: `seo` nav item (icon TrendingUp) added to all three persona lists after
  `analytics`; `nav.seo` i18n.
- Full i18n (`seoHub.*` block) in all six locales, native translations, "Pack" stays
  untranslated per brand rule. NO EMOJI; Tailwind CSS variables only; dates/numbers via the
  active locale.

## Error handling

- No provider → every SERP surface shows the connect state; endpoints return a typed 409
  `{"code": "no_seo_provider"}` the UI maps to the state (never fake data).
- Provider/HTTP errors during cron: log, skip keyword, keep previous snapshot; the UI shows
  the last snapshot date so staleness is visible.
- Crawl failures during scoring: skip that page, score against the pages that worked (min 1;
  else 502 with a clear message).
- LLM missing/failing: deterministic scoring still returned, `brief: null`.
- Cap and duplicate handling as in the router section. Cron per-project isolation.

## Testing

Backend (pytest, SQLite harness pattern; DataForSEO + crawler + LLM all patched):
- Provider resolution precedence (org key → env → None) and `serp()` payload normalization
  (position/url match for the project domain, top10 shape, features).
- Tracking: add/cap-400/dup-409/foreign-404; snapshot idempotent per day; deltas computed
  from history.
- Alerts: drop/gain thresholds incl. fell-out-of-top10 critical and null-position handling;
  first-snapshot baseline silent; ISO-week dedupe; alerts carry `/seo` deep link.
- Cron: only provider-connected projects with active keywords; per-project failure isolation.
- Scoring: term coverage statuses (present/underused/missing) on fixture pages; word-count
  median; PAA questions; LLM-less degradation (brief null); crawl-failure partial scoring;
  SERP cache reuse (no second provider call within 7 days).
Frontend: `npm run typecheck`; visual pass (gate state, table, drawer, editor tab) in both
themes and at least one RTL locale spot-check.

## Scope / phasing (one spec, phased plan)

- **Phase A** — provider layer + models/migration + rank tracking service/cron/alerts +
  `/seo` router (tracking endpoints) + SEO hub page (gate, table, drawer, add bar) + i18n.
- **Phase B** — content scoring service + score endpoint + ContentScoreCard + editor
  Optimize tab + i18n additions.

## Reused infrastructure

DataForSEO provider scaffold (`app/integrations/seo_apis/`), encrypted `APIKey` storage +
Settings keys UI, monitoring alert engine + alerts inbox + bell, crawler service, `call_llm`
locale directive, arq cron + per-project isolation pattern, recharts chart idioms from
analytics, keyword research + GSC top queries for suggestions, i18n conventions.
