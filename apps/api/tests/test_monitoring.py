"""
Tests for the monitoring/alerts data layer (watched_competitors, monitor_snapshots, alerts).

Strategy (mirrors test_autopilot.py):
- In-memory SQLite (aiosqlite) engine, own session factory
- Create only the SQLite-compatible tables this feature touches
"""
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.project import Project
from app.models.analytics import GscConnection
from app.models.monitoring import WatchedCompetitor, MonitorSnapshot, Alert  # noqa: F401

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "projects", "gsc_connections", "gsc_query_stats",
    "watched_competitors", "monitor_snapshots", "alerts",
]

FAKE_ORG_ID = uuid.uuid4()


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
