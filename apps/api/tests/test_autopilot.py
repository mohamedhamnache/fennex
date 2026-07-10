"""
Tests for the deterministic (zero-LLM) autopilot weekly planner.

Strategy (mirrors test_campaigns.py):
- In-memory SQLite (aiosqlite) engine, own session factory
- Create only the SQLite-compatible tables this planner touches
- Patch `get_opportunities` rather than seeding real GSC query stats
"""
import types
import uuid
from contextlib import asynccontextmanager
from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.campaign import Campaign, CampaignStep
from app.models.project import Project
from app.models.analytics import GscConnection
from app.services.autopilot_service import generate_weekly_plan, monday_of

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = ["projects", "campaigns", "campaign_steps", "gsc_connections"]

FAKE_ORG_ID = uuid.uuid4()
FAKE_PROJECT_ID = uuid.uuid4()


@pytest.fixture(autouse=True)
async def setup_db():
    tables = [
        Base.metadata.tables[name]
        for name in SQLITE_COMPATIBLE_TABLES
        if name in Base.metadata.tables
    ]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, tables=tables)


@pytest.fixture
async def db_session():
    async with TestSessionLocal() as session:
        yield session


# ── Helpers ───────────────────────────────────────────────────────────────────

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


@asynccontextmanager
async def _single_session(session):
    yield session


# ── Tests ─────────────────────────────────────────────────────────────────────

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
               new=AsyncMock(return_value=_opps(striking=[_opp()]))):
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


@pytest.mark.asyncio
async def test_stale_cancelled_even_when_no_opportunities(db_session):
    p = await _mk_project(db_session)
    stale = Campaign(
        org_id=FAKE_ORG_ID, project_id=p.id, goal="stale plan", persona="creator",
        source="autopilot", status="planned",
        week_of=monday_of(date.today() - timedelta(days=7)),
    )
    db_session.add(stale)
    await db_session.commit()

    with patch("app.services.autopilot_service.get_opportunities",
               new=AsyncMock(return_value=_opps())):
        result = await generate_weekly_plan(p, db_session)
    assert result is None

    await db_session.refresh(stale)
    assert stale.status == "cancelled"


# ── Cron task ─────────────────────────────────────────────────────────────────

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
