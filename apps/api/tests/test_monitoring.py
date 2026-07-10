"""
Tests for the monitoring/alerts data layer (watched_competitors, monitor_snapshots, alerts).

Strategy (mirrors test_autopilot.py):
- In-memory SQLite (aiosqlite) engine, own session factory
- Create only the SQLite-compatible tables this feature touches
"""
import uuid
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User, UserRole
from app.models.analytics import GscConnection
from app.models.monitoring import WatchedCompetitor, MonitorSnapshot, Alert  # noqa: F401

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects", "gsc_connections", "gsc_query_stats",
    "watched_competitors", "monitor_snapshots", "alerts",
]

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()

fake_user = User(
    id=FAKE_USER_ID,
    org_id=FAKE_ORG_ID,
    email="test@fennex.ai",
    hashed_password="hashed",
    full_name="Test User",
    role=UserRole.OWNER,
    is_active=True,
)


async def override_get_current_user():
    return fake_user


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


async def override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@pytest.fixture
async def org_and_project(db_session):
    org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
    db_session.add(org)
    await db_session.flush()
    project = Project(id=uuid.uuid4(), org_id=FAKE_ORG_ID, name="Test Project", domain="example.com")
    db_session.add(project)
    await db_session.commit()
    return org, project


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _mk_project(db, persona="creator", enabled=True, gsc=True):
    p = Project(org_id=FAKE_ORG_ID, name="P", domain="p.com", persona=persona,
                autopilot_enabled=enabled)
    db.add(p); await db.commit(); await db.refresh(p)
    if gsc:
        db.add(GscConnection(project_id=p.id, org_id=FAKE_ORG_ID, is_active=True))
        await db.commit()
    return p


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_alert_dedupe_unique_constraint(db_session):
    p = await _mk_project(db_session)
    a1 = Alert(org_id=FAKE_ORG_ID, project_id=p.id, kind="ranking_drop", severity="warning",
               title="t", url="/x", dedupe_key="k:2026-W28")
    db_session.add(a1)
    await db_session.commit()
    a2 = Alert(org_id=FAKE_ORG_ID, project_id=p.id, kind="ranking_drop", severity="warning",
               title="t2", url="/x", dedupe_key="k:2026-W28")
    db_session.add(a2)
    with pytest.raises(Exception):
        await db_session.commit()
    await db_session.rollback()


async def _seed_stats(db, project_id, rows):
    """rows: list of (query, position, impressions[, clicks])"""
    from app.models.analytics import GscQueryStat
    await db.execute(delete(GscQueryStat).where(GscQueryStat.project_id == project_id))
    for r in rows:
        q, pos, imp = r[0], r[1], r[2]
        clicks = r[3] if len(r) > 3 else 0
        db.add(GscQueryStat(project_id=project_id, org_id=FAKE_ORG_ID,
                            query=q, position=pos, impressions=imp, clicks=clicks, ctr=0.0))
    await db.commit()


@pytest.mark.asyncio
async def test_rankings_first_run_is_silent(db_session):
    from app.services.monitoring_service import detect_rankings
    p = await _mk_project(db_session)
    await _seed_stats(db_session, p.id, [("menu digital", 4.0, 200)])
    assert await detect_rankings(p.id, FAKE_ORG_ID, db_session) == 0
    snaps = (await db_session.execute(select(MonitorSnapshot))).scalars().all()
    assert len(snaps) == 1 and snaps[0].kind == "rankings"
    assert (await db_session.execute(select(Alert))).scalars().first() is None


@pytest.mark.asyncio
async def test_rankings_drop_gain_and_thresholds(db_session):
    from app.services.monitoring_service import detect_rankings
    p = await _mk_project(db_session)
    await _seed_stats(db_session, p.id, [
        ("off page one", 8.0, 200),   # will fall off page 1 -> critical
        ("small drop", 5.0, 200),     # will worsen 2.0 -> below threshold, silent
        ("big riser", 14.0, 200),     # will improve into top10 -> info gain
        ("low traffic", 4.0, 30),     # will worsen 5.0 but impressions < 50 -> silent
    ])
    await detect_rankings(p.id, FAKE_ORG_ID, db_session)  # first run: snapshot only
    await _seed_stats(db_session, p.id, [
        ("off page one", 12.5, 200),
        ("small drop", 7.0, 200),
        ("big riser", 6.0, 200),
        ("low traffic", 9.0, 30),
    ])
    created = await detect_rankings(p.id, FAKE_ORG_ID, db_session)
    alerts = (await db_session.execute(select(Alert))).scalars().all()
    kinds = {(a.kind, a.severity) for a in alerts}
    assert created == 2
    assert ("ranking_drop", "critical") in kinds       # off page one: 8.0 -> 12.5
    assert ("ranking_gain", "info") in kinds           # big riser: 14.0 -> 6.0
    assert all("small drop" not in a.title and "low traffic" not in a.title for a in alerts)
    drop = next(a for a in alerts if a.kind == "ranking_drop")
    assert "off page one" in drop.title and "8.0" in (drop.detail or "") and "12.5" in (drop.detail or "")


@pytest.mark.asyncio
async def test_rankings_dedupe_same_week_and_warning_severity(db_session):
    from app.services.monitoring_service import detect_rankings
    p = await _mk_project(db_session)
    await _seed_stats(db_session, p.id, [("stays page one", 3.0, 200)])
    await detect_rankings(p.id, FAKE_ORG_ID, db_session)
    await _seed_stats(db_session, p.id, [("stays page one", 7.5, 200)])  # worsens 4.5, still page 1
    assert await detect_rankings(p.id, FAKE_ORG_ID, db_session) == 1
    a = (await db_session.execute(select(Alert))).scalars().one()
    assert a.severity == "warning"
    # same condition re-detected the same week -> deduped
    await _seed_stats(db_session, p.id, [("stays page one", 11.0, 200)])
    # previous snapshot now 7.5 -> 11.0 = 3.5 drop again, but same query+week dedupe key
    assert await detect_rankings(p.id, FAKE_ORG_ID, db_session) == 0
    assert len((await db_session.execute(select(Alert))).scalars().all()) == 1


def _card(title="T", meta="M", wc=1000, h2=5, schema=None):
    return {"title": title, "meta_description": meta, "word_count": wc,
            "h2_count": h2, "schema_types": schema or ["Article"]}


async def _mk_watch(db, project_id, url="https://rival.com/guide", card=None):
    w = WatchedCompetitor(org_id=FAKE_ORG_ID, project_id=project_id, url=url,
                          last_scorecard=card)
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return w


@asynccontextmanager
async def _single_session(session):
    yield session


@pytest.mark.asyncio
async def test_competitor_first_scan_is_silent_and_stores(db_session):
    from app.services import monitoring_service
    p = await _mk_project(db_session)
    w = await _mk_watch(db_session, p.id, card=None)
    with patch.object(monitoring_service, "scan_scorecard", new=AsyncMock(return_value=_card())):
        assert await monitoring_service.detect_competitors(p.id, FAKE_ORG_ID, db_session) == 0
    await db_session.refresh(w)
    assert w.last_scorecard == _card() and w.last_scanned_at is not None
    assert (await db_session.execute(select(Alert))).scalars().first() is None


@pytest.mark.asyncio
async def test_competitor_change_facets_alert(db_session):
    from app.services import monitoring_service
    p = await _mk_project(db_session)
    await _mk_watch(db_session, p.id, card=_card())
    changed = _card(title="New Title", wc=1300, schema=["Article", "FAQPage"])  # 3 facets
    with patch.object(monitoring_service, "scan_scorecard", new=AsyncMock(return_value=changed)):
        assert await monitoring_service.detect_competitors(p.id, FAKE_ORG_ID, db_session) == 1
    a = (await db_session.execute(select(Alert))).scalars().one()
    assert a.kind == "competitor_change" and a.severity == "warning"
    assert "title" in (a.detail or "") and "word count" in (a.detail or "") and "FAQPage" in (a.detail or "")


@pytest.mark.asyncio
async def test_competitor_unchanged_and_small_changes_are_silent(db_session):
    from app.services import monitoring_service
    p = await _mk_project(db_session)
    await _mk_watch(db_session, p.id, card=_card(wc=1000, h2=5))
    minor = _card(wc=1100, h2=7)  # wc +10% (<20%), h2 +2 (<3) -> silent
    with patch.object(monitoring_service, "scan_scorecard", new=AsyncMock(return_value=minor)):
        assert await monitoring_service.detect_competitors(p.id, FAKE_ORG_ID, db_session) == 0


@pytest.mark.asyncio
async def test_competitor_crawl_failure_skips_and_keeps_scorecard(db_session):
    from app.services import monitoring_service
    p = await _mk_project(db_session)
    w = await _mk_watch(db_session, p.id, card=_card())
    with patch.object(monitoring_service, "scan_scorecard", new=AsyncMock(side_effect=RuntimeError("down"))):
        assert await monitoring_service.detect_competitors(p.id, FAKE_ORG_ID, db_session) == 0
    await db_session.refresh(w)
    assert w.last_scorecard == _card()  # unchanged
    assert (await db_session.execute(select(Alert))).scalars().first() is None


@pytest.mark.asyncio
async def test_market_first_run_silent_then_single_aggregated_alert(db_session):
    from app.services.monitoring_service import detect_market
    p = await _mk_project(db_session)
    await _seed_stats(db_session, p.id, [("existing topic", 5.0, 400)])
    assert await detect_market(p.id, FAKE_ORG_ID, db_session) == 0
    await _seed_stats(db_session, p.id, [
        ("existing topic", 5.0, 900),      # riser: 400 -> 900 (>=2x, >=100)
        ("brand new query", 6.0, 120),     # new demand (>=50)
        ("tiny new query", 6.0, 20),       # new but < 50 -> ignored
    ])
    created = await detect_market(p.id, FAKE_ORG_ID, db_session)
    assert created == 1  # ONE aggregated alert
    a = (await db_session.execute(select(Alert).where(Alert.kind == "market_shift"))).scalars().one()
    assert a.severity == "info"
    assert "brand new query" in (a.detail or "") and "existing topic" in (a.detail or "")
    assert "tiny new query" not in (a.detail or "")
    # re-run same week -> deduped
    assert await detect_market(p.id, FAKE_ORG_ID, db_session) == 0


@pytest.mark.asyncio
async def test_weekly_crons_iterate_and_isolate_failures(db_session):
    from app.workers.tasks import monitoring_tasks
    p_gsc = await _mk_project(db_session)               # active GSC -> market monitor
    p_watch = await _mk_project(db_session, gsc=False)  # watchlist -> competitor monitor
    await _mk_watch(db_session, p_watch.id)
    calls: list[str] = []

    async def fake_market(project_id, org_id, db):
        calls.append(f"market:{project_id}")
        raise RuntimeError("boom")

    async def fake_comp(project_id, org_id, db):
        calls.append(f"comp:{project_id}")
        return 0

    with patch.object(monitoring_tasks, "detect_market", new=fake_market), \
         patch.object(monitoring_tasks, "detect_competitors", new=fake_comp), \
         patch.object(monitoring_tasks, "async_session_factory",
                      new=lambda: _single_session(db_session)):
        await monitoring_tasks.run_market_monitor(None)     # must not raise despite boom
        await monitoring_tasks.run_competitor_monitor(None)
    assert f"market:{p_gsc.id}" in calls and f"comp:{p_watch.id}" in calls


# ── API router ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_alerts_endpoints(client, db_session, org_and_project):
    p = await _mk_project(db_session)
    for i in range(3):
        db_session.add(Alert(org_id=FAKE_ORG_ID, project_id=p.id, kind="ranking_drop",
                             severity="warning", title=f"t{i}", url="/x", dedupe_key=f"k{i}"))
    await db_session.commit()
    r = await client.get(f"/api/v1/monitoring/alerts?project_id={p.id}")
    assert r.status_code == 200 and len(r.json()) == 3
    first_id = r.json()[0]["id"]
    r = await client.post(f"/api/v1/monitoring/alerts/{first_id}/read")
    assert r.status_code == 200
    r = await client.get(f"/api/v1/monitoring/alerts?project_id={p.id}&unread_only=true")
    assert len(r.json()) == 2
    r = await client.get(f"/api/v1/monitoring/alerts/unread-count?project_id={p.id}")
    assert r.json()["count"] == 2
    r = await client.post(f"/api/v1/monitoring/alerts/read-all?project_id={p.id}")
    assert r.json()["marked"] == 2
    r = await client.get(f"/api/v1/monitoring/alerts/unread-count?project_id={p.id}")
    assert r.json()["count"] == 0


@pytest.mark.asyncio
async def test_watchlist_endpoints_validation(client, db_session, org_and_project):
    p = await _mk_project(db_session)
    r = await client.post("/api/v1/monitoring/competitors",
                          json={"project_id": str(p.id), "url": "https://rival.com", "label": "Rival"})
    assert r.status_code == 201, r.text
    wid = r.json()["id"]
    # duplicate URL -> 409
    r = await client.post("/api/v1/monitoring/competitors",
                          json={"project_id": str(p.id), "url": "https://rival.com"})
    assert r.status_code == 409
    # invalid URL -> 400
    r = await client.post("/api/v1/monitoring/competitors",
                          json={"project_id": str(p.id), "url": "not-a-url"})
    assert r.status_code == 400
    # cap 10
    for i in range(9):
        await client.post("/api/v1/monitoring/competitors",
                          json={"project_id": str(p.id), "url": f"https://r{i}.com"})
    r = await client.post("/api/v1/monitoring/competitors",
                          json={"project_id": str(p.id), "url": "https://one-too-many.com"})
    assert r.status_code == 400
    r = await client.get(f"/api/v1/monitoring/competitors?project_id={p.id}")
    assert len(r.json()) == 10
    r = await client.delete(f"/api/v1/monitoring/competitors/{wid}")
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_watchlist_add_rejects_foreign_project(client, db_session, org_and_project):
    r = await client.post("/api/v1/monitoring/competitors",
                          json={"project_id": str(uuid.uuid4()), "url": "https://rival.com"})
    assert r.status_code == 404
