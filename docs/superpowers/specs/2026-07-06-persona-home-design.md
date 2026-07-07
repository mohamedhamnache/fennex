# Persona Home + North-Star Dashboard + Tool Gating — Design Spec

Date: 2026-07-06
Feature #3 from `docs/superpowers/plans/2026-07-05-fennex-coherence-and-differentiation.md`.

## Purpose

Wire persona into the product instead of merely storing it. Today `persona`/`persona_data`
only flavor prompts and Mission Control; every user sees the same generic Overview and the
same fixed sidebar. This feature makes the home dashboard lead with a single persona-specific
north-star metric and re-orders the sidebar around the persona's primary tools — closing the
"persona stored but not wired" gap identified in the coherence roadmap.

## Scope (v1)

- **North-star metric, goal-framed per persona** (creator / ecommerce / freelancer), all derived
  from the project's real GSC data.
- **Persona home**: the existing Overview page is reorganized around the north-star; Mission
  Control and Recent articles are kept.
- **Tool gating**: sidebar reorders to surface the persona's primary tools in a highlighted
  "For you" group; everything else stays reachable under a collapsible "More tools". Nothing is
  removed.
- **One backend endpoint** computes the persona-shaped payload (Approach A).

Out of scope: a separate `/home` route; a configurable per-persona layout engine; hiding tools
entirely; per-date history of query classification (so buyer-intent/niche get no fake deltas).

## Architecture (Approach A)

A single `GET /analytics/persona-home` endpoint returns the persona payload, computed in a new
`get_persona_home` service function that reuses existing analytics building blocks
(`get_overview`, `get_market_insights`, `get_opportunities`, `_classify_query`). The Overview
page renders it; a `personaNav` helper reorders the sidebar. Clean boundaries: one endpoint, one
page reorganization, one nav helper.

## Backend

### Endpoint
`GET /analytics/persona-home?project_id=<uuid>&persona=<creator|ecommerce|freelancer>`
- Registered in `app/api/v1/routers/analytics.py`, before the `/gsc/*` block, using `CurrentUser`/`DB`.
- `persona` query param; invalid/missing → defaults to `creator`.

### Service — `get_persona_home(project_id, org_id, persona, db) -> PersonaHome`
Add to `app/services/analytics_service.py` (where `_classify_query`, `get_overview`,
`get_market_insights`, `get_opportunities` already live).

Reuses:
- `get_overview(project_id, org_id, "28d", db)` — clicks, impressions, ctr, avg_position + changes.
- `get_traffic(project_id, org_id, "28d", db)` — returns `list[TrafficDataPoint]`; clicks field gives the sparkline for the trend.
- `get_market_insights(project_id, org_id, db)` — clusters + ideas + total_impressions.
- `get_opportunities(project_id, org_id, db)` — striking_distance + ctr_wins.
- `GscQueryStat` rows + `_classify_query(query)` — for buyer-intent classification.

Per-persona payloads:

- **creator** — north_star `{key:"clicks", label:"Audience reached (clicks)", value:overview.clicks,
  unit:"", change:overview.clicks_change, trend:<28d clicks sparkline>}`.
  secondary: impressions (change), CTR %, avg position (invert change).
  focus: `{title:"Content ideas with demand", items:[top 5 ideas where idea_type in
  {question,how-to,list}]}` from market_insights.ideas.

- **ecommerce** — buyer_intent = iterate `GscQueryStat`; sum clicks and impressions where
  `_classify_query(query) in {"commercial","comparison"}`.
  north_star `{key:"buyer_intent_clicks", label:"Buyer-intent clicks", value:buyer_intent_clicks,
  context:"<pct>% of your clicks"}` where pct = round(buyer_intent_clicks / max(1,overview.clicks) * 100).
  secondary: total clicks, buyer-intent impressions, striking-distance count
  (len(opps.striking_distance)).
  focus: `{title:"Commercial opportunities", items:[top 5 opportunities whose query classifies
  commercial/comparison, else top striking_distance]}`.

- **freelancer** — north_star `{key:"niche_visibility", label:"Niche visibility (impressions)",
  value:market.total_impressions, context:"across <N> topics"}` where N = len(market.clusters).
  secondary: topics mapped (len clusters), striking-distance opportunities
  (len(opps.striking_distance)), total clicks.
  focus: `{title:"Topics to target", items:[top 5 clusters by clicks -> label=topic,
  detail="<query_count> queries, avg pos <avg_position>"]}`.

Zero-data safety: every field defaults to 0 / empty lists; `north_star.value` 0 is valid and the
UI shows a "Connect Search Console" hint.

### Schemas — `app/schemas/analytics.py`
```python
class NorthStar(BaseModel):
    key: str
    label: str
    value: float
    unit: str = ""
    change: float | None = None
    context: str | None = None
    trend: list[float] = []

class SecondaryMetric(BaseModel):
    key: str
    label: str
    value: float
    unit: str = ""
    change: float | None = None
    invert_change: bool = False

class FocusItem(BaseModel):
    label: str
    detail: str

class FocusList(BaseModel):
    title: str
    items: list[FocusItem]

class PersonaHome(BaseModel):
    persona: str
    north_star: NorthStar
    secondary: list[SecondaryMetric]
    focus: FocusList
```

## Frontend

### API client — `apps/web/lib/api.ts`
Types mirroring the schemas above + `getPersonaHome(projectId, persona)` →
`apiClient.get<PersonaHome>('/analytics/persona-home?project_id=...&persona=...')`.

### Overview page — `app/(dashboard)/[projectId]/overview/page.tsx`
Becomes the persona home. `persona = project?.persona ?? "creator"`. Layout order:
1. **North-star hero card** (new component `PersonaNorthStar`) — large value, label, and either a
   trend sparkline (creator) or the `context` sub-stat (ecommerce/freelancer). Change shown with
   up/down tone when present.
2. **MissionControl** (existing, unchanged).
3. **Secondary metrics row** — StatCards from `north_star`-adjacent `secondary[]` (reuse `StatCard`).
4. **Focus card** (new) — `focus.title` + list of `focus.items`, beside a persona-tailored
   **Quick actions** column:
   - creator: Run keyword research, Create article, Create social post
   - ecommerce: Open Product Studio, View Market (analytics?ws=market), View analytics
   - freelancer: Plan outreach (agents/nomad), Generate market report (analytics?ws=market&oasis=1),
     Scan a competitor (analytics?ws=competitors)
5. **Recent articles** (existing, unchanged).

The generic hardcoded 28-day StatCard row is replaced by the persona secondary row; Recent
articles and MissionControl stay.

### Sidebar — `apps/web/components/layout/Sidebar.tsx`
A `personaNav(persona)` helper produces the nav groups:
- A highlighted **"For you"** group first, containing the persona's primary items in order:
  - creator: overview, articles, social, images, agents, analytics
  - ecommerce: overview, images, analytics, agents, keywords
  - freelancer: overview, agents, analytics, social, backlinks
- Remaining items go under a single collapsible **"More tools"** group (default collapsed;
  expansion state persisted in `localStorage` key `fennex-nav-more`).
- Persona read from `currentProject.persona` (falls back to `creator`). All existing items remain
  present; only order/grouping changes.
- The item registry (label/href/icon) is defined once and referenced by both the persona groups
  and "More tools" so nothing is duplicated or dropped.

## Error handling

- No GSC connection / no synced data → endpoint returns zeros and empty focus; hero shows 0 with a
  "Connect Search Console" link to `/{projectId}/analytics`.
- Unknown persona value → treated as `creator` on both backend and frontend.
- Endpoint failure → Overview falls back to showing MissionControl + Recent articles (hero and
  secondary hidden), never a blank page.

## Testing

- **Backend (pytest, mirrors `tests/test_articles.py` SQLite harness):**
  - `get_persona_home` creator → north_star.value equals summed 28d clicks.
  - ecommerce → buyer-intent value equals clicks summed over commercial/comparison `GscQueryStat`
    rows (seed one commercial query, one informational; assert only the commercial counts).
  - freelancer → niche value equals market total_impressions; secondary topics == cluster count.
  - endpoint returns 200 and the persona echoes back; unknown persona → `creator`.
- **Frontend:** `npm run typecheck`; visual check of all three personas (switch via Mission
  Control persona selector) — hero, secondary, focus, quick actions, and sidebar order all change.

## Reused infrastructure

- `analytics_service`: `get_overview`, `get_market_insights`, `get_opportunities`, `_classify_query`.
- `GscQueryStat` / `AnalyticsSnapshot` for metrics.
- `StatCard`, `Card`, `MissionControl`, `PageHeader` components.
- Persona storage on `Project` (`persona`), already surfaced via `listProjects`.
- Deep links used by quick actions: `analytics?ws=market`, `?ws=competitors`, `agents/nomad`,
  `analytics?ws=market&oasis=1`.
