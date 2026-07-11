"""
Tests for SERP Intelligence (E1) — Task 1: org-scoped DataForSEO provider + serp().

Strategy (mirrors test_monitoring.py):
- In-memory SQLite (aiosqlite) engine, own session factory
- Create only the SQLite-compatible tables this feature touches
"""
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.project import Project
from app.models.analytics import GscConnection
from app.models.api_key import APIKey  # noqa: F401
from app.models.monitoring import Alert, MonitorSnapshot  # noqa: F401
from app.models.seo_intel import TrackedKeyword, SerpSnapshot

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

# Grows over the following tasks in this feature.
SQLITE_COMPATIBLE_TABLES = [
    "projects", "gsc_connections", "api_keys",
    "tracked_keywords", "serp_snapshots", "alerts", "monitor_snapshots",
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
    p = Project(org_id=FAKE_ORG_ID, name="P", domain="pure-saveur.fr", persona=persona,
                autopilot_enabled=enabled)
    db.add(p); await db.commit(); await db.refresh(p)
    if gsc:
        db.add(GscConnection(project_id=p.id, org_id=FAKE_ORG_ID, is_active=True))
        await db.commit()
    return p


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_provider_resolution_precedence(db_session, monkeypatch):
    from app.integrations.seo_apis import get_seo_provider_for_org
    from app.core.security import encrypt_value
    from app.models.api_key import APIKey
    # 1. nothing -> None
    monkeypatch.setattr("app.core.config.settings.DATAFORSEO_LOGIN", "", raising=False)
    monkeypatch.setattr("app.core.config.settings.DATAFORSEO_PASSWORD", "", raising=False)
    assert await get_seo_provider_for_org(FAKE_ORG_ID, db_session) is None
    # 2. env fallback -> real provider
    monkeypatch.setattr("app.core.config.settings.DATAFORSEO_LOGIN", "envuser", raising=False)
    monkeypatch.setattr("app.core.config.settings.DATAFORSEO_PASSWORD", "envpass", raising=False)
    p = await get_seo_provider_for_org(FAKE_ORG_ID, db_session)
    assert p is not None and p._auth == ("envuser", "envpass")
    # 3. org key wins over env
    db_session.add(APIKey(org_id=FAKE_ORG_ID, provider="dataforseo",
                          encrypted_value=encrypt_value("orguser:orgpass")))
    await db_session.commit()
    p = await get_seo_provider_for_org(FAKE_ORG_ID, db_session)
    assert p._auth == ("orguser", "orgpass")


@pytest.mark.asyncio
async def test_mock_provider_serp_deterministic():
    from app.integrations.seo_apis.mock_provider import MockSEOProvider
    provider = MockSEOProvider()
    items = await provider.serp("running shoes")
    assert len(items) == 10
    assert items[0]["type"] == "organic"
    assert items[0]["rank_absolute"] == 1
    assert items[0]["domain"] == "site1.com"
    assert items[0]["url"] == "https://site1.com/page"
    assert items[0]["title"] == "Result 1 for running shoes"
    # deterministic across calls
    items2 = await provider.serp("running shoes")
    assert items == items2


@pytest.mark.asyncio
async def test_get_seo_provider_for_org_uses_project(db_session):
    """Sanity: _mk_project sets the domain used by later tasks."""
    from app.integrations.seo_apis import get_seo_provider_for_org
    p = await _mk_project(db_session)
    assert p.domain == "pure-saveur.fr"
    assert await get_seo_provider_for_org(FAKE_ORG_ID, db_session) is None


@pytest.mark.asyncio
async def test_tracked_keyword_dedupe_unique_constraint(db_session):
    p = await _mk_project(db_session)
    k1 = TrackedKeyword(org_id=FAKE_ORG_ID, project_id=p.id, keyword="running shoes")
    db_session.add(k1)
    await db_session.commit()
    k2 = TrackedKeyword(org_id=FAKE_ORG_ID, project_id=p.id, keyword="running shoes")
    db_session.add(k2)
    with pytest.raises(Exception):
        await db_session.commit()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_serp_snapshot_dedupe_unique_constraint(db_session):
    import datetime
    p = await _mk_project(db_session)
    k = TrackedKeyword(org_id=FAKE_ORG_ID, project_id=p.id, keyword="running shoes")
    db_session.add(k)
    await db_session.commit()
    await db_session.refresh(k)
    d = datetime.date(2026, 7, 11)
    s1 = SerpSnapshot(org_id=FAKE_ORG_ID, project_id=p.id, tracked_keyword_id=k.id, date=d, position=3.0)
    db_session.add(s1)
    await db_session.commit()
    s2 = SerpSnapshot(org_id=FAKE_ORG_ID, project_id=p.id, tracked_keyword_id=k.id, date=d, position=5.0)
    db_session.add(s2)
    with pytest.raises(Exception):
        await db_session.commit()
    await db_session.rollback()
