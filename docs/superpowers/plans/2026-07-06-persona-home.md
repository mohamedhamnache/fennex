# Persona Home + North-Star Dashboard + Tool Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the home dashboard lead with a persona-specific north-star metric and re-order the sidebar around each persona's primary tools, all from real GSC data.

**Architecture:** One `GET /analytics/persona-home` endpoint (service `get_persona_home`) computes a persona-shaped payload by reusing `get_overview`, `get_traffic`, `get_market_insights`, `get_opportunities`, and `_classify_query`. The Overview page renders a `PersonaHomeSection` (hero + secondary + focus + quick actions); a `personaNav` helper reorders the sidebar into a "For you" group plus a collapsible "More tools".

**Tech Stack:** FastAPI, SQLAlchemy 2 async, pytest/pytest-asyncio (backend); Next.js 14 App Router, TypeScript, TanStack Query, Tailwind (frontend).

Spec: `docs/superpowers/specs/2026-07-06-persona-home-design.md`

## Global Constraints

- **NO EMOJI** anywhere — code, UI strings, comments, commit messages.
- Backend async throughout; Pydantic v2 `BaseModel`; routers use `CurrentUser`/`DB` from `app.core.dependencies`; org-scoped via `current_user.org_id`.
- API mounted under `/api/v1`; the analytics router already exists at prefix `/analytics`.
- Personas: `creator | ecommerce | freelancer`; unknown/missing → `creator` (both backend and frontend).
- Only the **creator** north-star has a real `change`/`trend`; ecommerce/freelancer use a `context` string, never a fabricated delta.
- Frontend: all API calls via `apiClient` from `lib/api.ts`; Tailwind CSS variables only (no hard-coded colors); verify with `npm run typecheck` (no FE test framework).
- Query classification word sets (in `analytics_service.py`): commercial = {buy, price, prices, pricing, cheap, deal, deals, shop, coupon, discount, sale, cost, order, store, shipping}; comparison = {vs, versus, or, compare, comparison, alternative, alternatives, difference}. Buyer-intent = classify in {commercial, comparison}.
- Commit style: `feat(persona-home): ...`.

### i18n (binding for Tasks 4 & 5 — full i18n was chosen over literals)

Every user-visible string goes through `t()` (react-i18next). The backend still returns English
`label`/`title` strings; the frontend renders them via `t()` keyed on the stable `key` fields,
using the backend string as `defaultValue` (belt-and-suspenders). Add all new keys to
`apps/web/public/locales/en/common.json`; the other five locales (fr, es, de, pt, ar) fall back to
`en` automatically (established pattern), so no other locale file needs editing.

Render patterns:
- north-star label: `t(\`personaHome.northStar.${ns.key}\`, { defaultValue: ns.label })`
- secondary label: `t(\`personaHome.secondary.${m.key}\`, { defaultValue: m.label })`
- focus title: `t(\`personaHome.focus.${persona}\`, { defaultValue: data.focus.title })`
- quick-action label: `t(\`personaHome.actions.${action.key}\`)` (each action carries a `key`)
- sidebar item label: `t(\`nav.${item.key}\`)` (reuse existing `nav.*`; add `nav.agents`)
- sidebar group labels: `t("nav.forYou")`, `t("nav.moreTools")`

Keys to ADD to `en/common.json` (merge into existing objects; do not remove existing keys):
```json
"nav": { "agents": "Agents", "forYou": "For you", "moreTools": "More tools" },
"personaHome": {
  "quickActions": "Quick actions",
  "connectGsc": "Connect Search Console to see real data",
  "emptyFocus": "Nothing here yet — sync more Search Console data.",
  "northStar": {
    "clicks": "Audience reached (clicks)",
    "buyer_intent_clicks": "Buyer-intent clicks",
    "niche_visibility": "Niche visibility (impressions)"
  },
  "secondary": {
    "impressions": "Impressions", "ctr": "Avg CTR", "position": "Avg position",
    "clicks": "Total clicks", "bi_impressions": "Buyer-intent impressions",
    "striking": "Striking-distance", "topics": "Topics mapped"
  },
  "focus": {
    "creator": "Content ideas with demand",
    "ecommerce": "Commercial opportunities",
    "freelancer": "Topics to target"
  },
  "actions": {
    "keywords": "Run keyword research", "articles": "Create article", "social": "Create social post",
    "productStudio": "Open Product Studio", "market": "View market", "analytics": "View analytics",
    "outreach": "Plan outreach", "marketReport": "Generate market report", "competitor": "Scan a competitor"
  }
}
```
The quick-action arrays must carry a `key` matching `personaHome.actions.*`:
creator = keywords/articles/social; ecommerce = productStudio/market/analytics;
freelancer = outreach/marketReport/competitor. The `href` values are unchanged from the task code.

---

### Task 1: Backend schemas + `get_persona_home` service

**Files:**
- Modify: `apps/api/app/schemas/analytics.py` (append schemas)
- Modify: `apps/api/app/services/analytics_service.py` (append `get_persona_home`)
- Test: `apps/api/tests/test_persona_home.py` (create)

**Interfaces:**
- Consumes: `get_overview`, `get_traffic`, `get_market_insights`, `get_opportunities`, `_classify_query` (all in `analytics_service.py`); `GscQueryStat`, `AnalyticsSnapshot` models.
- Produces:
  - Schemas `NorthStar`, `SecondaryMetric`, `FocusItem`, `FocusList`, `PersonaHome`.
  - `async get_persona_home(project_id, org_id, persona: str, db) -> PersonaHome`.

- [ ] **Step 1: Add the schemas** — append to `apps/api/app/schemas/analytics.py`:
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

- [ ] **Step 2: Write the failing tests** — create `apps/api/tests/test_persona_home.py`. Copy the SQLite harness blocks from `tests/test_recommendations.py` (engine, `override_get_db`, fake user, `setup_db`, `db_session`, `org_and_project`, `client`) with this table list and imports:
```python
SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects",
    "analytics_snapshots", "gsc_query_stats",
]
from app.models.analytics import AnalyticsSnapshot, GscQueryStat  # noqa: F401
```
Then the service tests:
```python
from datetime import date, timedelta

import pytest


@pytest.mark.asyncio
async def test_creator_north_star_is_clicks(db_session, org_and_project):
    from app.services.analytics_service import get_persona_home
    db_session.add(AnalyticsSnapshot(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                     date=date.today(), clicks=40, impressions=800, ctr=0.05, avg_position=6.0))
    db_session.add(AnalyticsSnapshot(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                     date=date.today() - timedelta(days=1),
                                     clicks=30, impressions=600, ctr=0.05, avg_position=6.0))
    await db_session.commit()
    home = await get_persona_home(FAKE_PROJECT_ID, FAKE_ORG_ID, "creator", db_session)
    assert home.persona == "creator"
    assert home.north_star.key == "clicks"
    assert home.north_star.value == 70.0
    assert len(home.secondary) == 3


@pytest.mark.asyncio
async def test_ecommerce_north_star_is_buyer_intent(db_session, org_and_project):
    from app.services.analytics_service import get_persona_home
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                query="buy running shoes", clicks=50, impressions=800, ctr=0.06, position=4.0))
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                query="chocolate cake recipe", clicks=20, impressions=300, ctr=0.06, position=5.0))
    await db_session.commit()
    home = await get_persona_home(FAKE_PROJECT_ID, FAKE_ORG_ID, "ecommerce", db_session)
    assert home.north_star.key == "buyer_intent_clicks"
    assert home.north_star.value == 50.0            # only the commercial query counts
    assert home.north_star.context is not None      # "X% of your clicks"


@pytest.mark.asyncio
async def test_freelancer_north_star_is_niche_visibility(db_session, org_and_project):
    from app.services.analytics_service import get_persona_home
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                query="wedding photography paris", clicks=10, impressions=500, ctr=0.02, position=7.0))
    db_session.add(GscQueryStat(project_id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID,
                                query="event photographer rates", clicks=5, impressions=250, ctr=0.02, position=9.0))
    await db_session.commit()
    home = await get_persona_home(FAKE_PROJECT_ID, FAKE_ORG_ID, "freelancer", db_session)
    assert home.north_star.key == "niche_visibility"
    assert home.north_star.value == 750.0           # total impressions across queries/clusters
    assert home.north_star.context is not None


@pytest.mark.asyncio
async def test_unknown_persona_defaults_creator(db_session, org_and_project):
    from app.services.analytics_service import get_persona_home
    home = await get_persona_home(FAKE_PROJECT_ID, FAKE_ORG_ID, "banana", db_session)
    assert home.persona == "creator"
    assert home.north_star.key == "clicks"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `docker compose exec -T api pytest tests/test_persona_home.py -v`
Expected: FAIL (`get_persona_home` not defined).

- [ ] **Step 4: Implement the service** — append to `apps/api/app/services/analytics_service.py` (imports `GscQueryStat`, `select`, and the new schemas are already available in the module or add to its schema imports):
```python
from app.schemas.analytics import (
    NorthStar,
    SecondaryMetric,
    FocusItem,
    FocusList,
    PersonaHome,
)

_BUYER_INTENT = {"commercial", "comparison"}


async def get_persona_home(project_id, org_id, persona: str, db) -> PersonaHome:
    if persona not in ("creator", "ecommerce", "freelancer"):
        persona = "creator"

    ov = await get_overview(project_id, org_id, "28d", db)

    if persona == "creator":
        traffic = await get_traffic(project_id, org_id, "28d", db)
        market = await get_market_insights(project_id, org_id, db)
        ideas = [i for i in market.ideas if i.idea_type in ("question", "how-to", "list")][:5]
        return PersonaHome(
            persona=persona,
            north_star=NorthStar(
                key="clicks", label="Audience reached (clicks)", value=float(ov.clicks),
                change=ov.clicks_change, trend=[t.clicks for t in traffic],
            ),
            secondary=[
                SecondaryMetric(key="impressions", label="Impressions", value=float(ov.impressions), change=ov.impressions_change),
                SecondaryMetric(key="ctr", label="Avg CTR", value=round(ov.ctr * 100, 2), unit="%", change=ov.ctr_change),
                SecondaryMetric(key="position", label="Avg position", value=round(ov.avg_position, 1), change=ov.position_change, invert_change=True),
            ],
            focus=FocusList(
                title="Content ideas with demand",
                items=[FocusItem(label=i.query, detail=f"{i.impressions:,} impressions · {i.idea_type}") for i in ideas],
            ),
        )

    if persona == "ecommerce":
        rows = (await db.execute(
            select(GscQueryStat).where(GscQueryStat.project_id == project_id, GscQueryStat.org_id == org_id)
        )).scalars().all()
        bi = [r for r in rows if _classify_query(r.query) in _BUYER_INTENT]
        bi_clicks = sum(r.clicks for r in bi)
        bi_impr = sum(r.impressions for r in bi)
        pct = round(bi_clicks / max(1, ov.clicks) * 100)
        opps = await get_opportunities(project_id, org_id, db)
        commercial_opps = [o for o in (opps.striking_distance + opps.ctr_wins) if _classify_query(o.query) in _BUYER_INTENT]
        chosen = (commercial_opps or opps.striking_distance)[:5]
        return PersonaHome(
            persona=persona,
            north_star=NorthStar(
                key="buyer_intent_clicks", label="Buyer-intent clicks", value=float(bi_clicks),
                context=f"{pct}% of your clicks",
            ),
            secondary=[
                SecondaryMetric(key="clicks", label="Total clicks", value=float(ov.clicks), change=ov.clicks_change),
                SecondaryMetric(key="bi_impressions", label="Buyer-intent impressions", value=float(bi_impr)),
                SecondaryMetric(key="striking", label="Striking-distance", value=float(len(opps.striking_distance))),
            ],
            focus=FocusList(
                title="Commercial opportunities",
                items=[FocusItem(label=o.query, detail=f"pos {o.position:.1f} · +{o.potential_clicks} potential") for o in chosen],
            ),
        )

    # freelancer
    market = await get_market_insights(project_id, org_id, db)
    opps = await get_opportunities(project_id, org_id, db)
    clusters = sorted(market.clusters, key=lambda c: c.clicks, reverse=True)[:5]
    return PersonaHome(
        persona=persona,
        north_star=NorthStar(
            key="niche_visibility", label="Niche visibility (impressions)", value=float(market.total_impressions),
            context=f"across {len(market.clusters)} topics",
        ),
        secondary=[
            SecondaryMetric(key="topics", label="Topics mapped", value=float(len(market.clusters))),
            SecondaryMetric(key="striking", label="Striking-distance", value=float(len(opps.striking_distance))),
            SecondaryMetric(key="clicks", label="Total clicks", value=float(ov.clicks), change=ov.clicks_change),
        ],
        focus=FocusList(
            title="Topics to target",
            items=[FocusItem(label=c.topic, detail=f"{c.query_count} queries · avg pos {c.avg_position}") for c in clusters],
        ),
    )
```
Note: verify `GscQueryStat` and `select` are already imported at the top of `analytics_service.py` (they are — `get_market_insights`/`get_opportunities` use them). Add the schema import block if the module imports schemas individually.

- [ ] **Step 5: Run tests to verify they pass**

Run: `docker compose exec -T api pytest tests/test_persona_home.py -v`
Expected: PASS (4).

- [ ] **Step 6: Commit**

```bash
git add apps/api/app/schemas/analytics.py apps/api/app/services/analytics_service.py apps/api/tests/test_persona_home.py
git commit -m "feat(persona-home): persona-shaped home payload service + schemas"
```

---

### Task 2: Backend endpoint `GET /analytics/persona-home`

**Files:**
- Modify: `apps/api/app/api/v1/routers/analytics.py`
- Test: `apps/api/tests/test_persona_home.py` (append endpoint tests)

**Interfaces:**
- Consumes: `get_persona_home` (Task 1); `PersonaHome` schema; `CurrentUser`, `DB`.
- Produces route: `GET /api/v1/analytics/persona-home?project_id=&persona=` → `PersonaHome`.

- [ ] **Step 1: Write the failing endpoint tests** — append to `tests/test_persona_home.py`:
```python
@pytest.mark.asyncio
async def test_persona_home_endpoint(client, org_and_project):
    r = await client.get(f"/api/v1/analytics/persona-home?project_id={FAKE_PROJECT_ID}&persona=ecommerce")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["persona"] == "ecommerce"
    assert body["north_star"]["key"] == "buyer_intent_clicks"


@pytest.mark.asyncio
async def test_persona_home_endpoint_defaults_creator(client, org_and_project):
    r = await client.get(f"/api/v1/analytics/persona-home?project_id={FAKE_PROJECT_ID}")
    assert r.status_code == 200
    assert r.json()["persona"] == "creator"
```

- [ ] **Step 2: Run to verify fail**

Run: `docker compose exec -T api pytest tests/test_persona_home.py -k endpoint -v`
Expected: FAIL (404 / route missing).

- [ ] **Step 3: Add the endpoint** — in `apps/api/app/api/v1/routers/analytics.py`, add `PersonaHome` to the `from app.schemas.analytics import (...)` block, then add the route just after the `analytics_market_report` route (before the `/gsc/*` routes):
```python
@router.get("/persona-home", response_model=PersonaHome)
async def analytics_persona_home(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    persona: str = "creator",
):
    from app.services.analytics_service import get_persona_home
    return await get_persona_home(project_id, current_user.org_id, persona, db)
```

- [ ] **Step 4: Run to verify pass**

Run: `docker compose exec -T api pytest tests/test_persona_home.py -v`
Expected: PASS (all 6).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/api/v1/routers/analytics.py apps/api/tests/test_persona_home.py
git commit -m "feat(persona-home): GET /analytics/persona-home endpoint"
```

---

### Task 3: Frontend API client + types

**Files:**
- Modify: `apps/web/lib/api.ts`

**Interfaces:**
- Produces: types `NorthStar`, `SecondaryMetric`, `FocusItem`, `FocusList`, `PersonaHome`; `getPersonaHome(projectId, persona)`.

- [ ] **Step 1: Add types + function** — append near the analytics section of `apps/web/lib/api.ts`:
```typescript
export interface NorthStar {
  key: string;
  label: string;
  value: number;
  unit: string;
  change: number | null;
  context: string | null;
  trend: number[];
}

export interface SecondaryMetric {
  key: string;
  label: string;
  value: number;
  unit: string;
  change: number | null;
  invert_change: boolean;
}

export interface FocusItem {
  label: string;
  detail: string;
}

export interface FocusList {
  title: string;
  items: FocusItem[];
}

export interface PersonaHome {
  persona: string;
  north_star: NorthStar;
  secondary: SecondaryMetric[];
  focus: FocusList;
}

export async function getPersonaHome(projectId: string, persona: string): Promise<PersonaHome> {
  return apiClient.get<PersonaHome>(`/analytics/persona-home?project_id=${projectId}&persona=${persona}`);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/api.ts
git commit -m "feat(persona-home): frontend api client and types"
```

---

### Task 4: `PersonaHomeSection` component + Overview wiring

**Files:**
- Create: `apps/web/components/projects/PersonaHomeSection.tsx`
- Modify: `apps/web/app/(dashboard)/[projectId]/overview/page.tsx`
- Modify: `apps/web/public/locales/en/common.json` (add the `personaHome` keys from Global Constraints → i18n)

**Interfaces:**
- Consumes: `getPersonaHome`, `PersonaHome`, `SecondaryMetric` (Task 3); `StatCard`, `Card`.
- Produces: `<PersonaHomeSection projectId persona />` default export.

**i18n (binding):** This task is subject to Global Constraints → i18n. The component code below
shows English literals for readability; you MUST instead render every user-visible label via `t()`
using the exact patterns and keys in that section. Concretely: add
`import { useTranslation } from "react-i18next";` and `const { t } = useTranslation();`; give each
`QUICK_ACTIONS` entry a `key` (creator: keywords/articles/social; ecommerce:
productStudio/market/analytics; freelancer: outreach/marketReport/competitor) and render its label
as `t(\`personaHome.actions.${a.key}\`)`; render the north-star/secondary/focus labels and the
"Quick actions" heading, "Connect Search Console" link, and empty-focus text via their `t()` keys;
and add the listed keys to `en/common.json`. After implementing, grep the new files for hardcoded
user-visible strings and confirm none remain (icons/keys/classNames excepted).

- [ ] **Step 1: Build the component** — `apps/web/components/projects/PersonaHomeSection.tsx`:
```typescript
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Search, FileText, Share2, ImagePlus, BarChart2, ShoppingBag, Compass, Swords } from "lucide-react";
import { getPersonaHome, type SecondaryMetric } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const QUICK_ACTIONS: Record<string, { label: string; href: string; icon: React.ElementType }[]> = {
  creator: [
    { label: "Run keyword research", href: "keywords", icon: Search },
    { label: "Create article", href: "articles", icon: FileText },
    { label: "Create social post", href: "social", icon: Share2 },
  ],
  ecommerce: [
    { label: "Open Product Studio", href: "images", icon: ImagePlus },
    { label: "View market", href: "analytics?ws=market", icon: ShoppingBag },
    { label: "View analytics", href: "analytics", icon: BarChart2 },
  ],
  freelancer: [
    { label: "Plan outreach", href: "agents/nomad", icon: Compass },
    { label: "Generate market report", href: "analytics?ws=market&oasis=1", icon: FileText },
    { label: "Scan a competitor", href: "analytics?ws=competitors", icon: Swords },
  ],
};

function secondaryTone(i: number): "violet" | "emerald" | "amber" {
  return (["violet", "emerald", "amber"] as const)[i % 3];
}

export function PersonaHomeSection({ projectId, persona }: { projectId: string; persona: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["persona-home", projectId, persona],
    queryFn: () => getPersonaHome(projectId, persona),
    staleTime: 5 * 60_000,
  });

  if (isLoading) return <div className="h-40 animate-pulse rounded-xl border bg-muted/30" />;
  if (!data) return null;

  const ns = data.north_star;
  const actions = QUICK_ACTIONS[persona] ?? QUICK_ACTIONS.creator;
  const noData = ns.value === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* North-star hero */}
      <Card className="p-5">
        <p className="text-xs font-medium text-muted-foreground">{ns.label}</p>
        <div className="mt-1 flex items-end gap-3">
          <span className="text-4xl font-bold tabular-nums text-foreground">{fmt(ns.value)}{ns.unit}</span>
          {ns.change !== null && (
            <span className={`mb-1 flex items-center gap-1 text-sm font-semibold ${ns.change >= 0 ? "text-success" : "text-destructive"}`}>
              {ns.change >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              {Math.abs(ns.change).toFixed(0)}%
            </span>
          )}
          {ns.context && <span className="mb-1 text-sm text-muted-foreground">{ns.context}</span>}
        </div>
        {noData && (
          <Link href={`/${projectId}/analytics`} className="mt-2 inline-block text-xs font-medium text-primary hover:underline">
            Connect Search Console to see real data
          </Link>
        )}
      </Card>

      {/* Secondary metrics */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {data.secondary.map((m: SecondaryMetric, i) => (
          <StatCard
            key={m.key}
            label={m.label}
            value={`${m.unit === "%" ? m.value.toFixed(2) : fmt(m.value)}${m.unit}`}
            change={m.change ?? undefined}
            invertChange={m.invert_change}
            tone={secondaryTone(i)}
            href={`/${projectId}/analytics`}
          />
        ))}
      </div>

      {/* Focus list + quick actions */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium text-foreground">{data.focus.title}</h2>
          <Card className="divide-y">
            {data.focus.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">Nothing here yet — sync more Search Console data.</p>
            ) : (
              data.focus.items.map((it, i) => (
                <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="truncate text-sm font-medium text-foreground">{it.label}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{it.detail}</span>
                </div>
              ))
            )}
          </Card>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-medium text-foreground">Quick actions</h2>
          <div className="flex flex-col gap-2">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={`/${projectId}/${a.href}`}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm font-medium transition-colors hover:border-primary/25 hover:bg-accent"
              >
                <a.icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.9} />
                {a.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into Overview** — in `apps/web/app/(dashboard)/[projectId]/overview/page.tsx`:
  1. Add import: `import { PersonaHomeSection } from "@/components/projects/PersonaHomeSection";`
  2. Replace the whole "Analytics stats — last 28 days" block (the `<div>` containing `<h2>{t("overview.last28Days")}</h2>` and its StatCard grid) with:
```tsx
      <PersonaHomeSection projectId={projectId} persona={project?.persona ?? "creator"} />
```
  3. Remove the now-duplicated "Quick actions" column from the bottom grid: change the Recent-articles wrapper from `lg:col-span-2` to full width and delete the sibling `<div>` that renders `<h2>{t("overview.quickActions")}</h2>` and its `QuickAction`s. Delete the now-unused `QuickAction` component and the `getAnalyticsOverview`/`getAnalyticsTraffic` imports and their `useQuery` calls if no longer referenced (the hero replaces them). Keep `listProjects`, `listArticles`.

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: no errors (remove any now-unused imports/vars the compiler flags).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/components/projects/PersonaHomeSection.tsx" "apps/web/app/(dashboard)/[projectId]/overview/page.tsx"
git commit -m "feat(persona-home): persona north-star home section on Overview"
```

---

### Task 5: Persona-ordered sidebar

**Files:**
- Modify: `apps/web/components/layout/Sidebar.tsx`
- Modify: `apps/web/public/locales/en/common.json` (add `nav.agents`, `nav.forYou`, `nav.moreTools` — see Global Constraints → i18n; skip any already added in Task 4)

**Interfaces:**
- Consumes: `currentProject.persona` (already available via `listProjects`).

**i18n (binding):** This task is subject to Global Constraints → i18n. `NAV_ITEMS` must NOT carry
literal `label` strings; instead each item carries a `key` (its href slug: overview, agents,
keywords, content→use key `planner`, articles, social, images, publishing, backlinks, analytics,
audit) and `renderNavItem` renders the label as `t(\`nav.${item.key}\`)` reusing the existing
`nav.*` keys (add only `nav.agents`). The "For you" / "More tools" group headings render via
`t("nav.forYou")` / `t("nav.moreTools")`. Note: `content`'s existing key is `nav.planner`, so its
item `key` is `planner` while its `href` stays `content`. The component already has `t` in scope
(`const { t } = useTranslation();`). Do not remove existing `nav.*` keys.

- [ ] **Step 1: Add a single item registry + `personaNav` helper** — near the top of `Sidebar.tsx` (module scope, after imports). This defines every nav item once so nothing is duplicated or dropped:
```typescript
type NavItem = { label: string; href: string; icon: typeof LayoutDashboard };

// All destinations, defined once.
const NAV_ITEMS: Record<string, NavItem> = {
  overview:   { label: "Overview",   href: "overview",   icon: LayoutDashboard },
  agents:     { label: "Agents",     href: "agents",     icon: Sparkles },
  keywords:   { label: "Keywords",   href: "keywords",   icon: SearchCode },
  content:    { label: "Planner",    href: "content",    icon: FileText },
  articles:   { label: "Articles",   href: "articles",   icon: Zap },
  social:     { label: "Social",     href: "social",     icon: Share2 },
  images:     { label: "Images",     href: "images",     icon: ImagePlus },
  publishing: { label: "Publishing", href: "publishing", icon: Send },
  backlinks:  { label: "Backlinks",  href: "backlinks",  icon: Link2 },
  analytics:  { label: "Analytics",  href: "analytics",  icon: BarChart2 },
  audit:      { label: "Audit",      href: "audit",      icon: SearchCode },
};

// Persona -> primary tool order (the highlighted "For you" group).
const PERSONA_PRIMARY: Record<string, string[]> = {
  creator:    ["overview", "articles", "social", "images", "agents", "analytics"],
  ecommerce:  ["overview", "images", "analytics", "agents", "keywords"],
  freelancer: ["overview", "agents", "analytics", "social", "backlinks"],
};

function personaNav(persona: string): { primary: NavItem[]; more: NavItem[] } {
  const order = PERSONA_PRIMARY[persona] ?? PERSONA_PRIMARY.creator;
  const primaryKeys = new Set(order);
  const primary = order.map((k) => NAV_ITEMS[k]);
  const more = Object.keys(NAV_ITEMS).filter((k) => !primaryKeys.has(k)).map((k) => NAV_ITEMS[k]);
  return { primary, more };
}
```

- [ ] **Step 2: Replace `navGroups` usage with persona groups.** Inside the component, compute persona and groups, and add "More tools" collapse state:
```typescript
  const persona = currentProject?.persona ?? "creator";
  const { primary, more } = personaNav(persona);
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    const saved = localStorage.getItem("fennex-nav-more");
    if (saved !== null) setMoreOpen(saved === "1");
  }, []);
  function toggleMore() {
    setMoreOpen((o) => { localStorage.setItem("fennex-nav-more", o ? "0" : "1"); return !o; });
  }
```
(`currentProject` is defined below the existing `navGroups`; move the `personaNav` call to after `currentProject` is computed, or read `persona` where `currentProject` is in scope. Place these lines just after the `currentProject` const.)

- [ ] **Step 3: Render the new nav.** Replace the existing `<nav>...navGroups.map(...)...</nav>` block with a "For you" group + collapsible "More tools". Reuse the exact existing `<Link>` item markup (active state, icon, expanded label):
```tsx
        <nav className="flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 py-1">
          {/* For you */}
          <div>
            {expanded ? (
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary/60">For you</p>
            ) : (
              <div className="mx-2 mb-1.5 h-px bg-white/[0.06]" />
            )}
            <ul className="space-y-0.5">
              {primary.map((item) => renderNavItem(item))}
            </ul>
          </div>

          {/* More tools */}
          <div>
            {expanded && (
              <button
                onClick={toggleMore}
                className="mb-1.5 flex w-full items-center gap-1 px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/25 hover:text-white/50"
              >
                More tools <ChevronDown className={cn("h-3 w-3 transition-transform", moreOpen && "rotate-180")} />
              </button>
            )}
            {(moreOpen || !expanded) && (
              <ul className="space-y-0.5">
                {more.map((item) => renderNavItem(item))}
              </ul>
            )}
          </div>
        </nav>
```
Define `renderNavItem` inside the component (returns the existing `<li><Link>...` markup used today, parameterized by `item`):
```tsx
  function renderNavItem(item: NavItem) {
    const href = currentProject ? `/${currentProject.id}/${item.href}` : "#";
    const active = !!currentProject &&
      (pathname === href || pathname.startsWith(`/${currentProject.id}/${item.href}`));
    return (
      <li key={item.href}>
        <Link
          href={href}
          title={!expanded ? item.label : undefined}
          className={cn(
            "group relative flex items-center rounded-xl text-[13px] font-medium transition-all",
            expanded ? "gap-3 px-2.5 py-2" : "justify-center p-2.5",
            active ? "bg-primary/15 text-primary" : "text-white/55 hover:bg-white/[0.05] hover:text-white/90",
            !currentProject && "pointer-events-none opacity-30",
          )}
        >
          {active && (
            <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary shadow-[0_0_8px_hsl(var(--primary))]" />
          )}
          <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.8} />
          {expanded && <span className="truncate">{item.label}</span>}
        </Link>
      </li>
    );
  }
```
Delete the old `navGroups` array and the `t("nav.*")` group labels it used (the item labels are now literals in `NAV_ITEMS`; this is acceptable and matches the sibling agents pages which use literal strings). Keep all other Sidebar code (workspace switcher, footer) unchanged.

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Restart web and smoke-test**

Run: `docker compose restart web && sleep 8 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/`
Expected: `200` or `302`. Then in the browser: switch persona via Mission Control's persona selector and confirm the sidebar "For you" group and the Overview hero/secondary/focus/quick-actions all change per persona.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/components/layout/Sidebar.tsx"
git commit -m "feat(persona-home): persona-ordered sidebar with For you + More tools"
```

---

## Final verification

- [ ] Backend: `docker compose exec -T api pytest tests/test_persona_home.py -v` — all PASS.
- [ ] Frontend: `cd apps/web && npm run typecheck` — clean.
- [ ] Restart: `docker compose restart api web`.
- [ ] Live check per persona (via Mission Control persona selector on Overview):
  - creator → hero "Audience reached (clicks)" with trend; sidebar leads Articles/Social/Images.
  - ecommerce → hero "Buyer-intent clicks" with "X% of your clicks"; sidebar leads Images/Analytics.
  - freelancer → hero "Niche visibility (impressions)" with "across N topics"; sidebar leads Agents/Analytics.
- [ ] Live endpoint smoke on the real project (mirror the container-python asserts used for prior features): `get_persona_home(project_id, org_id, "ecommerce", db)` returns a buyer-intent value ≤ total clicks.
