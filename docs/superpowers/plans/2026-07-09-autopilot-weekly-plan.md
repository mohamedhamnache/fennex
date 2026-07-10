# Autopilot Weekly Plan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Monday the Pack proposes a persona-shaped weekly campaign from real GSC opportunities; the user approves once on the Campaign Canvas and the artifacts auto-ship onto the Content Calendar.

**Architecture:** Autopilot is a scheduled campaign factory: a deterministic (zero-LLM) planner creates a normal `Campaign` tagged `source="autopilot"` + `week_of`; review/approve/execute reuse the existing campaign orchestrator and Canvas UI unchanged. Two additions to `execute_campaign`'s completion path: the existing auto-track hook is joined by a ship-to-calendar hook. Frontend adds an AutopilotCard (Home + Overview), a Settings toggle, and a deep-link/badge on the campaigns page.

**Tech Stack:** FastAPI + SQLAlchemy 2 async + Alembic + arq cron (backend); Next.js 14 + TanStack Query + react-i18next (frontend). No new dependencies.

Spec: `docs/superpowers/specs/2026-07-09-autopilot-weekly-plan-design.md`
Branch: continue on `feat/orchestrated-campaigns`.

## Global Constraints

- **NO EMOJI** anywhere (code, UI, comments, commit messages).
- Backend tests inside docker from repo root: `docker compose exec -T api pytest tests/<file> -v`. Migrations: `make db-migrate` (runs alembic inside the api container). Commit style `feat(autopilot): ...`.
- Frontend: all API via `apiClient` functions in `apps/web/lib/api.ts`; Tailwind CSS variables only (no hex in TSX); every user-visible string via `t()` — **all six locales** (`en/fr/es/de/pt/ar`) get the new keys in the same commit with key parity (native-quality translations, not English copies); dates formatted with the active i18n locale. Verify with `cd apps/web && npm run typecheck` (exit 0). Dev server port 3001.
- Hooks in `execute_campaign` must be isolated: wrapped in try/except, log on failure, never change campaign status (same contract as `_autotrack_campaign`).
- The planner is deterministic — no LLM call on Mondays. Never fabricate: no GSC/opportunities → no plan.
- Autopilot campaign shapes (exact action keys): creator = `zerda.pick_angle, dune.write_article, sirocco.generate_visual, nomad.social_posts`; ecommerce = `zerda.pick_angle, dune.write_article, sirocco.generate_visual`; freelancer = `zerda.pick_angle, dune.write_article, nomad.social_posts`.
- Campaign statuses: `planned|running|completed|failed|cancelled`. `source` values: `manual|autopilot`.

---

### Task 1: Migration + model columns + API serialization

**Files:**
- Create: `apps/api/alembic/versions/e3f4a5b6c7d8_autopilot_columns.py`
- Modify: `apps/api/app/models/campaign.py` (Campaign: add `source`, `week_of`)
- Modify: `apps/api/app/models/project.py` (add `autopilot_enabled`)
- Modify: `apps/api/app/api/v1/routers/campaigns.py` (`_campaign` serializer)
- Modify: `apps/api/app/api/v1/routers/projects.py` (`ProjectUpdate`, `ProjectResponse`, update handler)
- Test: `apps/api/tests/test_campaigns.py` (extend one assertion)

**Interfaces:**
- Produces: `Campaign.source: str` (default `"manual"`), `Campaign.week_of: date | None`, `Project.autopilot_enabled: bool` (default False); campaign JSON gains `"source"` and `"week_of"` (ISO string or null); `PUT /projects/{id}` accepts `autopilot_enabled`.

- [ ] **Step 1: Create the migration** `apps/api/alembic/versions/e3f4a5b6c7d8_autopilot_columns.py`:

```python
"""autopilot columns: campaigns.source/week_of, projects.autopilot_enabled

Revision ID: e3f4a5b6c7d8
Revises: d2c3a4m5p6g7
Create Date: 2026-07-09
"""
import sqlalchemy as sa
from alembic import op

revision = "e3f4a5b6c7d8"
down_revision = "d2c3a4m5p6g7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("campaigns", sa.Column("source", sa.String(20), nullable=False, server_default="manual"))
    op.add_column("campaigns", sa.Column("week_of", sa.Date(), nullable=True))
    op.add_column("projects", sa.Column("autopilot_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("projects", "autopilot_enabled")
    op.drop_column("campaigns", "week_of")
    op.drop_column("campaigns", "source")
```

- [ ] **Step 2: Model columns.** In `apps/api/app/models/campaign.py`, add to `Campaign` (after `cancel_requested`; import `Date` from sqlalchemy and `date` from datetime):

```python
    source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)  # manual | autopilot
    week_of: Mapped[date | None] = mapped_column(Date, nullable=True)  # Monday of the plan's week (autopilot only)
```

In `apps/api/app/models/project.py`, add after `persona_data`:

```python
    autopilot_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
```

- [ ] **Step 3: Serialize.** In `apps/api/app/api/v1/routers/campaigns.py`, `_campaign()` gains:

```python
            "source": c.source, "week_of": c.week_of.isoformat() if c.week_of else None,
```

In `apps/api/app/api/v1/routers/projects.py`: add `autopilot_enabled: Optional[bool] = None` to `ProjectUpdate`, `autopilot_enabled: bool = False` to `ProjectResponse`, and ensure the update handler copies it (follow the existing pattern for the other optional fields — if it iterates `model_dump(exclude_unset=True)` nothing more is needed; if it copies fields explicitly, add the field).

- [ ] **Step 4: Extend a test.** In `apps/api/tests/test_campaigns.py`, in `test_create_campaign_persists_plan`, add after the existing serializer assertions:

```python
    assert body["source"] == "manual"
    assert body["week_of"] is None
```

- [ ] **Step 5: Apply migration + run tests**

Run: `make db-migrate` → migration applies cleanly. Then `docker compose exec -T api pytest tests/test_campaigns.py -v` → ALL pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/alembic/versions/e3f4a5b6c7d8_autopilot_columns.py apps/api/app/models/campaign.py apps/api/app/models/project.py apps/api/app/api/v1/routers/campaigns.py apps/api/app/api/v1/routers/projects.py apps/api/tests/test_campaigns.py
git commit -m "feat(autopilot): campaign source/week_of and project autopilot_enabled columns"
```

---

### Task 2: Deterministic planner — `autopilot_service.generate_weekly_plan`

**Files:**
- Create: `apps/api/app/services/autopilot_service.py`
- Test: `apps/api/tests/test_autopilot.py` (new; copy the SQLite harness pattern from `tests/test_campaigns.py`)

**Interfaces:**
- Consumes: `get_opportunities(project_id, org_id, db)` from `app.services.analytics_service` — returns an object with `.striking_distance` and `.ctr_wins` lists whose items have `.query, .position, .impressions, .potential_clicks, .kind`; `GscConnection` (`is_active`); `Campaign`/`CampaignStep` models (Task 1 columns).
- Produces: `async generate_weekly_plan(project, db) -> Campaign | None` and `def monday_of(d: date) -> date`.

- [ ] **Step 1: Create the test harness + failing tests** in `apps/api/tests/test_autopilot.py`. Copy the harness idiom from `tests/test_campaigns.py` (in-memory SQLite `db_session` fixture creating only SQLite-compatible tables, `FAKE_ORG_ID`/`FAKE_PROJECT_ID` constants); include tables: `projects, campaigns, campaign_steps, gsc_connections`. Patch `get_opportunities` rather than seeding query stats:

```python
import types
import uuid
from datetime import date
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from app.models.campaign import Campaign, CampaignStep
from app.models.project import Project
from app.models.analytics import GscConnection
from app.services.autopilot_service import generate_weekly_plan, monday_of

def _opp(query="menu digital restaurant", pos=8.3, imp=480, potential=32, kind="striking_distance"):
    return types.SimpleNamespace(query=query, position=pos, impressions=imp,
                                 potential_clicks=potential, kind=kind)

def _opps(striking=None, ctr=None):
    return types.SimpleNamespace(striking_distance=striking or [], ctr_wins=ctr or [])

async def _mk_project(db, persona="creator", enabled=True, gsc=True):
    p = Project(org_id=FAKE_ORG_ID, name="P", domain="p.com", persona=persona,
                autopilot_enabled=enabled)
    db.add(p); await db.commit(); await db.refresh(p)
    if gsc:
        db.add(GscConnection(project_id=p.id, org_id=FAKE_ORG_ID, is_active=True))
        await db.commit()
    return p


@pytest.mark.asyncio
async def test_planner_builds_creator_plan(db_session):
    p = await _mk_project(db_session, persona="creator")
    with patch("app.services.autopilot_service.get_opportunities",
               new=AsyncMock(return_value=_opps(striking=[_opp()]))):
        c = await generate_weekly_plan(p, db_session)
    assert c is not None and c.source == "autopilot" and c.status == "planned"
    assert c.week_of == monday_of(date.today())
    assert "menu digital restaurant" in c.goal
    steps = (await db_session.execute(select(CampaignStep).where(
        CampaignStep.campaign_id == c.id).order_by(CampaignStep.order))).scalars().all()
    assert [s.action for s in steps] == [
        "zerda.pick_angle", "dune.write_article", "sirocco.generate_visual", "nomad.social_posts"]
    # why cites real numbers from the opportunity
    assert "8.3" in (steps[0].why or "") and "480" in (steps[0].why or "")


@pytest.mark.asyncio
async def test_planner_persona_shapes(db_session):
    for persona, expected in [
        ("ecommerce", ["zerda.pick_angle", "dune.write_article", "sirocco.generate_visual"]),
        ("freelancer", ["zerda.pick_angle", "dune.write_article", "nomad.social_posts"]),
    ]:
        p = await _mk_project(db_session, persona=persona)
        with patch("app.services.autopilot_service.get_opportunities",
                   new=AsyncMock(return_value=_opps(striking=[_opp()]))):
            c = await generate_weekly_plan(p, db_session)
        steps = (await db_session.execute(select(CampaignStep).where(
            CampaignStep.campaign_id == c.id).order_by(CampaignStep.order))).scalars().all()
        assert [s.action for s in steps] == expected


@pytest.mark.asyncio
async def test_planner_requires_optin_gsc_and_opportunities(db_session):
    disabled = await _mk_project(db_session, enabled=False)
    no_gsc = await _mk_project(db_session, gsc=False)
    empty = await _mk_project(db_session)
    with patch("app.services.autopilot_service.get_opportunities",
               new=AsyncMock(return_value=_opps(striking=[_opp()]))) as m:
        assert await generate_weekly_plan(disabled, db_session) is None
        assert await generate_weekly_plan(no_gsc, db_session) is None
    with patch("app.services.autopilot_service.get_opportunities",
               new=AsyncMock(return_value=_opps())):
        assert await generate_weekly_plan(empty, db_session) is None


@pytest.mark.asyncio
async def test_planner_idempotent_per_week_and_supersedes_stale(db_session):
    p = await _mk_project(db_session)
    with patch("app.services.autopilot_service.get_opportunities",
               new=AsyncMock(return_value=_opps(striking=[_opp()]))):
        first = await generate_weekly_plan(p, db_session)
        assert first is not None
        assert await generate_weekly_plan(p, db_session) is None  # same week -> no duplicate
        # a stale planned autopilot plan from a past week gets cancelled and replaced
        first.week_of = monday_of(date.today() - timedelta(days=7))
        await db_session.commit()
        second = await generate_weekly_plan(p, db_session)
        assert second is not None and second.week_of == monday_of(date.today())
        await db_session.refresh(first)
        assert first.status == "cancelled"
```

(Add `from datetime import timedelta` to the imports.)

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_autopilot.py -v` → FAIL (module `autopilot_service` not found).

- [ ] **Step 3: Implement** `apps/api/app/services/autopilot_service.py`:

```python
"""Autopilot: deterministic Monday planner — builds a persona-shaped Campaign
from the project's real GSC opportunities. Zero LLM cost; execution happens
only when the user launches the campaign (existing orchestrator)."""
import logging
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics import GscConnection
from app.models.campaign import Campaign, CampaignStep
from app.services.analytics_service import get_opportunities

logger = logging.getLogger(__name__)


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


# Persona -> ordered (agent, action, brief_kind). brief_kind flavors the templated brief.
_SHAPES: dict[str, list[tuple[str, str, str]]] = {
    "creator": [
        ("zerda", "zerda.pick_angle", "angle"),
        ("dune", "dune.write_article", "article"),
        ("sirocco", "sirocco.generate_visual", "visual"),
        ("nomad", "nomad.social_posts", "social"),
    ],
    "ecommerce": [
        ("zerda", "zerda.pick_angle", "angle"),
        ("dune", "dune.write_article", "buyer_article"),
        ("sirocco", "sirocco.generate_visual", "product_visual"),
    ],
    "freelancer": [
        ("zerda", "zerda.pick_angle", "angle"),
        ("dune", "dune.write_article", "authority_article"),
        ("nomad", "nomad.social_posts", "social"),
    ],
}

_BRIEFS: dict[str, dict] = {
    "angle": {},
    "article": {},
    "buyer_article": {"tone": "commercial", "focus": "buyer intent"},
    "authority_article": {"tone": "expert", "focus": "authority piece"},
    "product_visual": {"style": "product"},
    "visual": {},
    "social": {"platform": "linkedin"},
}


async def generate_weekly_plan(project, db: AsyncSession) -> Campaign | None:
    """Create this week's autopilot Campaign for the project, or None.

    None when: autopilot disabled, no active GSC connection, no opportunities,
    or a plan for this week already exists (idempotent). A stale *planned*
    autopilot plan from a past week is cancelled and replaced.
    """
    if not project.autopilot_enabled:
        return None

    gsc = (await db.execute(select(GscConnection).where(
        GscConnection.project_id == project.id,
        GscConnection.is_active.is_(True),
    ))).scalars().first()
    if gsc is None:
        return None

    week = monday_of(date.today())
    existing = (await db.execute(select(Campaign).where(
        Campaign.project_id == project.id,
        Campaign.source == "autopilot",
        Campaign.week_of == week,
    ))).scalars().first()
    if existing is not None:
        return None

    # Supersede stale unlaunched plans from previous weeks.
    stale = (await db.execute(select(Campaign).where(
        Campaign.project_id == project.id,
        Campaign.source == "autopilot",
        Campaign.status == "planned",
        Campaign.week_of < week,
    ))).scalars().all()
    for s in stale:
        s.status = "cancelled"

    opps = await get_opportunities(project.id, project.org_id, db)
    ranked = list(opps.striking_distance) + list(opps.ctr_wins)
    if not ranked:
        await db.commit()  # persist stale-cancellations even without a new plan
        return None
    top = ranked[0]

    persona = project.persona or "creator"
    shape = _SHAPES.get(persona, _SHAPES["creator"])
    why = (
        f"'{top.query}' is at position {top.position:.1f} with {top.impressions} "
        f"impressions - +{top.potential_clicks} potential clicks this month."
    )
    campaign = Campaign(
        org_id=project.org_id, project_id=project.id,
        goal=f"Week of {week.isoformat()}: win '{top.query}'",
        persona=persona, status="planned", source="autopilot", week_of=week,
        director_summary=(
            f"Autopilot picked the top opportunity from your real search data: {why}"
        ),
    )
    db.add(campaign)
    await db.flush()
    for i, (agent, action, brief_kind) in enumerate(shape):
        brief = dict(_BRIEFS[brief_kind])
        brief["keyword"] = top.query
        db.add(CampaignStep(
            campaign_id=campaign.id, order=i, agent=agent, action=action,
            brief=brief, why=why,
        ))
    await db.commit()
    await db.refresh(campaign)
    logger.info("autopilot: planned week %s for project %s", week, project.id)
    return campaign
```

- [ ] **Step 4: Run to verify pass** — `docker compose exec -T api pytest tests/test_autopilot.py -v` → 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/services/autopilot_service.py apps/api/tests/test_autopilot.py
git commit -m "feat(autopilot): deterministic weekly planner from real GSC opportunities"
```

---

### Task 3: Monday cron — `run_autopilot_planner`

**Files:**
- Create: `apps/api/app/workers/tasks/autopilot_tasks.py`
- Modify: `apps/api/app/workers/worker.py` (import, functions list, cron)
- Test: `apps/api/tests/test_autopilot.py` (append)

**Interfaces:**
- Consumes: `generate_weekly_plan(project, db)` (Task 2).
- Produces: `async run_autopilot_planner(ctx) -> None`, registered `cron(run_autopilot_planner, weekday=0, hour=7, minute=30, run_at_startup=False)`.

- [ ] **Step 1: Write failing tests** — append to `tests/test_autopilot.py`:

```python
@pytest.mark.asyncio
async def test_cron_plans_only_enabled_projects_and_isolates_failures(db_session):
    from app.workers.tasks import autopilot_tasks
    enabled_a = await _mk_project(db_session, enabled=True)
    enabled_b = await _mk_project(db_session, enabled=True)
    await _mk_project(db_session, enabled=False)

    calls: list = []

    async def fake_plan(project, db):
        calls.append(project.id)
        if project.id == enabled_a.id:
            raise RuntimeError("boom")  # one project failing must not break the batch
        return None

    with patch.object(autopilot_tasks, "generate_weekly_plan", new=fake_plan), \
         patch.object(autopilot_tasks, "async_session_factory",
                      new=lambda: _single_session(db_session)):
        await autopilot_tasks.run_autopilot_planner(None)

    assert set(calls) == {enabled_a.id, enabled_b.id}
```

(Reuse/define the `_single_session` context-manager helper exactly as in `tests/test_campaigns.py` — it wraps the fixture session so `async with async_session_factory() as s:` yields it without closing.)

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_autopilot.py::test_cron_plans_only_enabled_projects_and_isolates_failures -v` → FAIL (module not found).

- [ ] **Step 3: Implement** `apps/api/app/workers/tasks/autopilot_tasks.py`:

```python
"""Monday-morning autopilot planning for all opted-in projects."""
import logging

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.project import Project
from app.services.autopilot_service import generate_weekly_plan

logger = logging.getLogger(__name__)


async def run_autopilot_planner(ctx) -> None:
    async with async_session_factory() as db:
        projects = (await db.execute(
            select(Project).where(Project.autopilot_enabled.is_(True))
        )).scalars().all()
    for project in projects:
        try:
            async with async_session_factory() as db:
                await generate_weekly_plan(project, db)
        except Exception:  # noqa: BLE001 - one project must not break the batch
            logger.exception("autopilot planning failed for project %s", project.id)
```

Note for the test: the test patches `async_session_factory` on this module, so both `async with` blocks use the fixture session; `generate_weekly_plan` is also patched there. In `worker.py`: add `from app.workers.tasks.autopilot_tasks import run_autopilot_planner`, append `run_autopilot_planner` to `functions`, and add to `cron_jobs`:

```python
        # Monday-morning autopilot planning, after the 06:00 analytics sync
        cron(run_autopilot_planner, weekday=0, hour=7, minute=30, run_at_startup=False),
```

- [ ] **Step 4: Run to verify pass + worker registers**

Run: `docker compose exec -T api pytest tests/test_autopilot.py -v` → ALL pass. Then `docker compose restart worker && sleep 6 && docker compose logs worker 2>&1 | tail -5` → startup line lists `run_autopilot_planner`, no import errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/workers/tasks/autopilot_tasks.py apps/api/app/workers/worker.py apps/api/tests/test_autopilot.py
git commit -m "feat(autopilot): Monday planning cron for opted-in projects"
```

---

### Task 4: Ship-to-calendar hook on autopilot completion

**Files:**
- Modify: `apps/api/app/workers/tasks/campaign_tasks.py`
- Test: `apps/api/tests/test_autopilot.py` (append; extend harness tables with `calendar_entries`, `articles`, `generated_images`)

**Interfaces:**
- Consumes: `calendar_service.create_entry(project_id, org_id, data: dict, db)` (data keys: `content_type`, `content_id`, `scheduled_at`, optional `timezone`; entry lands as `planned`; raises `CalendarError` if the content row does not exist); `CalendarEntry` model; completed steps' `artifact_type`/`artifact_ids`/`structured`.
- Produces: `async _ship_autopilot_artifacts(campaign, steps, db) -> None` called after the final-status commit, gated `status == "completed" and source == "autopilot"`; helper `def _ship_dates(week_of, today, count) -> list[str]` (ISO datetimes at 09:00 UTC).

- [ ] **Step 1: Write failing tests** — append to `tests/test_autopilot.py` (add `calendar_entries`, `articles`, `generated_images` to the harness tables; import `CalendarEntry`, `Article`, `ArticleStatus`, `GeneratedImage`):

```python
@pytest.mark.asyncio
async def test_ship_hook_schedules_article_and_banner(db_session):
    from app.workers.tasks.campaign_tasks import _ship_autopilot_artifacts, _ship_dates
    p = await _mk_project(db_session)
    article = Article(org_id=FAKE_ORG_ID, project_id=p.id, title="T", status=ArticleStatus.ready)
    image = GeneratedImage(org_id=FAKE_ORG_ID, project_id=p.id, prompt="v", status="completed")
    db_session.add_all([article, image]); await db_session.commit()

    week = monday_of(date.today())
    c = Campaign(org_id=FAKE_ORG_ID, project_id=p.id, goal="g", persona="creator",
                 status="completed", source="autopilot", week_of=week)
    db_session.add(c); await db_session.commit()
    steps = [
        CampaignStep(campaign_id=c.id, order=0, agent="dune", action="dune.write_article",
                     status="completed", artifact_type="article", artifact_ids=[str(article.id)]),
        CampaignStep(campaign_id=c.id, order=1, agent="sirocco", action="sirocco.generate_visual",
                     status="completed", artifact_type="image",
                     structured={"image_id": str(image.id)}),
    ]
    db_session.add_all(steps); await db_session.commit()

    await _ship_autopilot_artifacts(c, steps, db_session)
    entries = (await db_session.execute(select(CalendarEntry))).scalars().all()
    assert {(e.content_type, e.state) for e in entries} == {("article", "planned"), ("banner", "planned")}
    assert all(e.scheduled_at.endswith("09:00:00+00:00") or "T09:00" in e.scheduled_at for e in entries)
    # duplicate guard: running again (resume) creates nothing new
    await _ship_autopilot_artifacts(c, steps, db_session)
    assert len((await db_session.execute(select(CalendarEntry))).scalars().all()) == 2
    # dates are distinct weekdays
    dates = sorted(e.scheduled_at[:10] for e in entries)
    assert len(set(dates)) == 2


@pytest.mark.asyncio
async def test_ship_hook_skips_manual_campaigns_and_isolates_failures(db_session):
    from app.workers.tasks import campaign_tasks
    p = await _mk_project(db_session)
    manual = Campaign(org_id=FAKE_ORG_ID, project_id=p.id, goal="g", persona="creator",
                      status="completed", source="manual")
    db_session.add(manual); await db_session.commit()
    await campaign_tasks._ship_autopilot_artifacts(manual, [], db_session)
    assert (await db_session.execute(select(CalendarEntry))).scalars().first() is None
    # a raising create_entry must not propagate
    auto = Campaign(org_id=FAKE_ORG_ID, project_id=p.id, goal="g", persona="creator",
                    status="completed", source="autopilot", week_of=monday_of(date.today()))
    db_session.add(auto); await db_session.commit()
    step = CampaignStep(campaign_id=auto.id, order=0, agent="dune", action="dune.write_article",
                        status="completed", artifact_type="article", artifact_ids=[str(uuid.uuid4())])
    db_session.add(step); await db_session.commit()
    with patch.object(campaign_tasks, "create_calendar_entry",
                      new=AsyncMock(side_effect=RuntimeError("boom"))):
        await campaign_tasks._ship_autopilot_artifacts(auto, [step], db_session)  # must not raise


def test_ship_dates_spread_and_rollover():
    from app.workers.tasks.campaign_tasks import _ship_dates
    week = date(2026, 7, 6)  # a Monday
    # early in the week: next weekdays of the same week
    d = _ship_dates(week, today=date(2026, 7, 6), count=2)
    assert d == ["2026-07-07T09:00:00+00:00", "2026-07-08T09:00:00+00:00"]
    # week exhausted: rolls into early next week
    d = _ship_dates(week, today=date(2026, 7, 10), count=2)
    assert d == ["2026-07-13T09:00:00+00:00", "2026-07-14T09:00:00+00:00"]
```

- [ ] **Step 2: Run to verify fail** — `docker compose exec -T api pytest tests/test_autopilot.py -k ship -v` → FAIL (names not defined).

- [ ] **Step 3: Implement in `apps/api/app/workers/tasks/campaign_tasks.py`.** Module-scope import (patchable, like `create_recommendation`):

```python
from app.services.calendar_service import create_entry as create_calendar_entry
```

Add the helpers:

```python
def _ship_dates(week_of, today, count: int) -> list[str]:
    """ISO datetimes at 09:00 UTC on distinct weekdays: the remaining weekdays of
    week_of's week strictly after today, rolling into early next week if exhausted."""
    out: list[str] = []
    d = max(week_of, today) + timedelta(days=1)
    while len(out) < count:
        if d.weekday() < 5:  # Mon-Fri
            out.append(f"{d.isoformat()}T09:00:00+00:00")
        d += timedelta(days=1)
    return out


async def _ship_autopilot_artifacts(campaign, steps, db) -> None:
    """Schedule a completed autopilot campaign's artifacts on the Content Calendar
    as planned entries (the calendar's arm/publish gate is unchanged). Isolated:
    failures are logged and never affect the campaign."""
    try:
        if campaign.source != "autopilot" or campaign.status != "completed":
            return
        targets: list[tuple[str, str]] = []  # (content_type, content_id)
        for s in steps:
            if s.status != "completed":
                continue
            if s.artifact_type == "article" and s.artifact_ids:
                targets.append(("article", str(s.artifact_ids[0])))
            elif s.artifact_type == "image" and (s.structured or {}).get("image_id"):
                targets.append(("banner", str(s.structured["image_id"])))
        if not targets:
            return
        from app.models.calendar_entry import CalendarEntry
        from sqlalchemy import select as _select
        dates = _ship_dates(campaign.week_of or _now_date(), _now_date(), len(targets))
        for (ctype, cid), when in zip(targets, dates):
            existing = (await db.execute(_select(CalendarEntry).where(
                CalendarEntry.project_id == campaign.project_id,
                CalendarEntry.content_type == ctype,
                CalendarEntry.content_id == uuid.UUID(cid),
            ))).scalars().first()
            if existing is not None:
                continue
            await create_calendar_entry(campaign.project_id, campaign.org_id,
                                        {"content_type": ctype, "content_id": cid,
                                         "scheduled_at": when}, db)
    except Exception:
        logger.exception("autopilot ship-to-calendar failed: %s", campaign.id)


def _now_date():
    from datetime import date as _d
    return _d.today()
```

Call it in `execute_campaign` right after the existing auto-track call:

```python
            if campaign.status == "completed":
                await _autotrack_campaign(campaign, steps, db)
                await _ship_autopilot_artifacts(campaign, steps, db)
```

(`timedelta` is already imported or add `from datetime import timedelta`; `uuid` already imported.)

- [ ] **Step 4: Run to verify pass** — `docker compose exec -T api pytest tests/test_autopilot.py tests/test_campaigns.py -v` → ALL pass (autopilot + existing 19 campaign tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/workers/tasks/campaign_tasks.py apps/api/tests/test_autopilot.py
git commit -m "feat(autopilot): ship completed weekly artifacts onto the content calendar"
```

---

### Task 5: Frontend types + Settings toggle

**Files:**
- Modify: `apps/web/lib/api.ts` (`Campaign`, `Project`, `updateProject`)
- Modify: `apps/web/app/(dashboard)/settings/page.tsx` (`ProjectSection` toggle row)
- Modify: `apps/web/public/locales/{en,fr,es,de,pt,ar}/common.json`

**Interfaces:**
- Produces: `Campaign.source: string; Campaign.week_of: string | null;` `Project.autopilot_enabled: boolean;` Settings toggle persisting via the existing `updateProject`; i18n keys `settings.project.autopilot` + `settings.project.autopilotHint`.

- [ ] **Step 1: Types.** In `apps/web/lib/api.ts`: add `source: string;` and `week_of: string | null;` to the `Campaign` interface; add `autopilot_enabled: boolean;` to `Project`; extend the `updateProject` patch type Pick list with `"autopilot_enabled"`.

- [ ] **Step 2: Toggle in `ProjectSection`** (`apps/web/app/(dashboard)/settings/page.tsx`). Add `autopilot_enabled` to the section's `form` state (seeded from `active.autopilot_enabled ?? false` in the existing `useEffect`), include it in `saveMutation`'s `updateProject` payload, and render after the persona `Field`:

```tsx
        <div className="flex items-center justify-between rounded-lg border border-border px-3.5 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">{t("settings.project.autopilot")}</p>
            <p className="text-xs text-muted-foreground">{t("settings.project.autopilotHint")}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.autopilot_enabled}
            onClick={() => setForm((f) => ({ ...f, autopilot_enabled: !f.autopilot_enabled }))}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${form.autopilot_enabled ? "bg-primary" : "bg-muted"}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${form.autopilot_enabled ? "left-[22px]" : "left-0.5"}`} />
          </button>
        </div>
```

- [ ] **Step 3: i18n.** Add to `settings.project` in **all six** locale files (translate natively for fr/es/de/pt/ar; en values):

```json
"autopilot": "Autopilot",
"autopilotHint": "Every Monday the Pack proposes a weekly plan from your real search data. You approve, they execute."
```

- [ ] **Step 4: Typecheck** — `cd apps/web && npm run typecheck` → exit 0. Validate every locale: `python3 -c "import json;[json.load(open(f'apps/web/public/locales/{l}/common.json')) for l in ['en','fr','es','de','pt','ar']];print('valid')"` (from repo root).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/api.ts "apps/web/app/(dashboard)/settings/page.tsx" apps/web/public/locales/*/common.json
git commit -m "feat(autopilot): project toggle in settings and frontend types"
```

---

### Task 6: AutopilotCard + mounts + campaigns deep link/badge

**Files:**
- Create: `apps/web/components/autopilot/AutopilotCard.tsx`
- Modify: `apps/web/app/(dashboard)/page.tsx` (mount on Home)
- Modify: `apps/web/app/(dashboard)/[projectId]/overview/page.tsx` (mount on Overview)
- Modify: `apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx` (`?campaign=` deep link + badge)
- Modify: `apps/web/public/locales/{en,fr,es,de,pt,ar}/common.json` (`autopilot.*` block)

**Interfaces:**
- Consumes: `listCampaigns(projectId)` (campaigns now carry `source`/`week_of` with `steps`); `sumEstimates`/`fmtEstimate` from `@/lib/campaignMeta`; i18n.
- Produces: `<AutopilotCard projectId={string} />` (self-fetching; renders nothing when no current-week autopilot campaign).

- [ ] **Step 1: Create `apps/web/components/autopilot/AutopilotCard.tsx`:**

```tsx
"use client";

import Link from "next/link";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Rocket, ArrowRight, CalendarCheck2, Loader2 } from "lucide-react";
import { listCampaigns } from "@/lib/api";
import { sumEstimates, fmtEstimate } from "@/lib/campaignMeta";
import { Card } from "@/components/ui/Card";

function mondayISO(d: Date): string {
  const day = (d.getDay() + 6) % 7; // Mon=0
  const m = new Date(d);
  m.setDate(d.getDate() - day);
  return m.toISOString().slice(0, 10);
}

export function AutopilotCard({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  const { data: campaigns = [] } = useQuery({
    queryKey: ["campaigns", projectId],
    queryFn: () => listCampaigns(projectId),
    staleTime: 60_000,
  });

  const week = mondayISO(new Date());
  const plan = campaigns.find((c) => c.source === "autopilot" && c.week_of === week);
  if (!plan || plan.status === "failed" || plan.status === "cancelled") return null;

  const weekLabel = new Date(week + "T00:00:00").toLocaleDateString(i18n.language, {
    month: "short", day: "numeric",
  });
  const done = plan.steps.filter((s) => s.status === "completed").length;
  const artifacts = plan.steps.filter((s) => s.status === "completed" && s.artifact_type).length;
  const href = `/${projectId}/campaigns?campaign=${plan.id}`;

  return (
    <Card className="flex items-center gap-4 border-primary/20 bg-gradient-to-r from-primary/[0.06] to-transparent p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
        {plan.status === "running"
          ? <Loader2 className="h-4.5 w-4.5 animate-spin" strokeWidth={1.9} />
          : plan.status === "completed"
            ? <CalendarCheck2 className="h-4.5 w-4.5" strokeWidth={1.9} />
            : <Rocket className="h-4.5 w-4.5" strokeWidth={1.9} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">
          {plan.status === "planned" && t("autopilot.titlePlanned")}
          {plan.status === "running" && t("autopilot.titleRunning")}
          {plan.status === "completed" && t("autopilot.titleDone")}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-medium text-primary">{t("autopilot.weekOf", { date: weekLabel })}</span>
          {" · "}
          {plan.status === "planned" && t("autopilot.bodyPlanned", {
            count: plan.steps.length,
            estimate: fmtEstimate(sumEstimates(plan.steps.map((s) => s.action)), t("campaigns.canvas.minutes")),
          })}
          {plan.status === "running" && t("autopilot.progress", { done, total: plan.steps.length })}
          {plan.status === "completed" && t("autopilot.bodyDone", { count: artifacts })}
        </p>
      </div>
      {plan.status === "completed" ? (
        <Link href={`/${projectId}/calendar`} className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent">
          {t("autopilot.viewCalendar")}
        </Link>
      ) : (
        <Link href={href} className="btn-primary inline-flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-xs">
          {plan.status === "planned" ? t("autopilot.review") : t("autopilot.view")}
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Mount.** Home (`app/(dashboard)/page.tsx`): render `{projectId && <AutopilotCard projectId={projectId} />}` between the greeting header and the bento grid. Overview (`app/(dashboard)/[projectId]/overview/page.tsx`): render `<AutopilotCard projectId={projectId} />` directly above the persona-gated block.

- [ ] **Step 3: Deep link + badge** in `app/(dashboard)/[projectId]/campaigns/page.tsx`:
  - `import { useSearchParams } from "next/navigation";` then inside the component:

```tsx
  const searchParams = useSearchParams();
  useEffect(() => {
    const c = searchParams.get("campaign");
    if (c) setActiveCampaignId(c);
  }, [searchParams]);
```

  (add `useEffect` to the react import if absent.)
  - Badge: where the selected-campaign header renders the status badge, and in `CampaignComposer`'s past-campaign cards, show for autopilot campaigns an extra badge chip `t("autopilot.badge")` + `t("autopilot.weekOf", { date })` (date = `week_of` formatted with `i18n.language`, `month: "short", day: "numeric"`) using the same badge styling with `bg-primary/10 text-primary` tones. `CampaignComposer` receives campaigns already — no prop changes needed beyond rendering.

- [ ] **Step 4: i18n.** Add a top-level `autopilot` block to **all six** locales (translate natively; en values):

```json
"autopilot": {
  "badge": "Autopilot",
  "weekOf": "Week of {{date}}",
  "titlePlanned": "The Pack planned your week",
  "bodyPlanned": "{{count}} steps · est. {{estimate}}",
  "review": "Review & approve",
  "view": "View",
  "titleRunning": "Autopilot is running your week",
  "progress": "{{done}} of {{total}} steps done",
  "titleDone": "Your week is scheduled",
  "bodyDone": "{{count}} artifacts created - drafts are on your calendar",
  "viewCalendar": "Open calendar"
}
```

- [ ] **Step 5: Typecheck + smoke + live check**

Run: `cd apps/web && npm run typecheck` → exit 0. `docker compose restart web && sleep 9 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/` → 200/302. Browser: enable Autopilot for a project in Settings; run the planner manually (`docker compose exec -T api python -c "import asyncio; from app.workers.tasks.autopilot_tasks import run_autopilot_planner; asyncio.run(run_autopilot_planner(None))"`); card appears on Home + Overview; Review opens the plan on the canvas; Launch executes; card shows progress then done; calendar shows planned entries; both themes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/autopilot/AutopilotCard.tsx "apps/web/app/(dashboard)/page.tsx" "apps/web/app/(dashboard)/[projectId]/overview/page.tsx" "apps/web/app/(dashboard)/[projectId]/campaigns/page.tsx" apps/web/public/locales/*/common.json
git commit -m "feat(autopilot): weekly plan card, campaigns deep link and badge"
```

---

## Final verification

- [ ] Backend: `docker compose exec -T api pytest tests/test_autopilot.py tests/test_campaigns.py -v` — all PASS.
- [ ] `make db-migrate` idempotent (re-run → no-op); worker logs list `run_autopilot_planner` + the Monday 07:30 cron.
- [ ] Frontend: `cd apps/web && npm run typecheck` clean; all six locale JSONs valid with `autopilot.*` + `settings.project.autopilot*` parity.
- [ ] Live end-to-end (as Task 6 Step 5): toggle → plan → card → canvas review → launch → calendar entries `planned` + Zerda tracking row.
- [ ] Ledger updated; branch ready.
