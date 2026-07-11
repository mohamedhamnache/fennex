"""
Tests for SERP Intelligence (E1) — Task 1: org-scoped DataForSEO provider + serp().

Strategy (mirrors test_monitoring.py):
- In-memory SQLite (aiosqlite) engine, own session factory
- Create only the SQLite-compatible tables this feature touches
"""
import uuid
from contextlib import asynccontextmanager
from datetime import date, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User, UserRole
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
    "organizations", "users", "projects", "gsc_connections", "api_keys",
    "tracked_keywords", "serp_snapshots", "alerts", "monitor_snapshots",
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
    p = Project(org_id=FAKE_ORG_ID, name="P", domain="pure-saveur.fr", persona=persona,
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


# ── Task 3: serp_service + rank_tracking_service ─────────────────────────────

def _serp_items(project_domain_rank: int | None = 3, n: int = 12):
    items = []
    rank = 1
    for i in range(1, n + 1):
        domain = "pure-saveur.fr" if project_domain_rank == i else f"site{i}.com"
        items.append({"type": "organic", "rank_absolute": rank,
                      "domain": domain, "url": f"https://{domain}/p", "title": f"R{i}"})
        rank += 1
    items.append({"type": "people_also_ask", "rank_absolute": rank})
    return items


class _FakeProvider:
    def __init__(self, items): self._items = items
    async def serp(self, keyword, language_code="en", location_code=2840): return self._items


@pytest.mark.asyncio
async def test_fetch_serp_normalizes_and_matches_domain(db_session):
    from app.services import serp_service
    p = await _mk_project(db_session)  # ensure _mk_project sets domain="pure-saveur.fr"
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(3)))):
        res = await serp_service.fetch_serp(p, "menu digital", db_session)
    assert res["position"] == 3.0 and "pure-saveur.fr" in res["url"]
    assert len(res["top10"]) == 10 and res["top10"][0]["rank"] == 1
    assert "people_also_ask" in res["features"]


@pytest.mark.asyncio
async def test_fetch_serp_not_ranked_and_no_provider(db_session):
    from app.services import serp_service
    p = await _mk_project(db_session)
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(None)))):
        res = await serp_service.fetch_serp(p, "kw", db_session)
    assert res["position"] is None and res["url"] is None
    with patch.object(serp_service, "get_seo_provider_for_org", new=AsyncMock(return_value=None)):
        assert await serp_service.fetch_serp(p, "kw", db_session) is None


@pytest.mark.asyncio
async def test_tracking_cap_duplicate_and_snapshot_idempotency(db_session):
    from app.services import serp_service, rank_tracking_service as rts
    p = await _mk_project(db_session)
    for i in range(25):
        await rts.add_keyword(p, f"kw {i}", db_session)
    with pytest.raises(rts.CapReached):
        await rts.add_keyword(p, "kw 26", db_session)
    with pytest.raises(rts.DuplicateKeyword):
        await rts.add_keyword(p, "kw 0", db_session)
    tk = (await db_session.execute(select(TrackedKeyword).where(
        TrackedKeyword.keyword == "kw 0"))).scalars().first()
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(2)))):
        s1 = await rts.snapshot_keyword(p, tk, db_session)
        s2 = await rts.snapshot_keyword(p, tk, db_session)  # same day -> None
    assert s1 is not None and s1.position == 2.0 and s2 is None


@pytest.mark.asyncio
async def test_list_with_stats_deltas(db_session):
    from app.services import rank_tracking_service as rts
    p = await _mk_project(db_session)
    tk = await rts.add_keyword(p, "menu digital", db_session)
    today = date.today()
    for days_ago, pos in [(30, 12.0), (7, 9.0), (0, 4.0)]:
        db_session.add(SerpSnapshot(org_id=FAKE_ORG_ID, project_id=p.id,
                                    tracked_keyword_id=tk.id, date=today - timedelta(days=days_ago),
                                    position=pos, url="https://pure-saveur.fr/p", top10=[], features=[]))
    await db_session.commit()
    rows = await rts.list_with_stats(p.id, FAKE_ORG_ID, db_session)
    row = rows[0]
    assert row["position"] == 4.0
    assert row["delta_7d"] == 5.0      # 9 -> 4 improvement
    assert row["delta_30d"] == 8.0     # 12 -> 4


# ── Task 4: daily rank tracker cron + serp_drop/serp_gain alerts ────────────

@pytest.mark.asyncio
async def test_snapshot_emits_serp_alerts_with_thresholds(db_session):
    from app.services import serp_service, rank_tracking_service as rts
    p = await _mk_project(db_session)
    tk = await rts.add_keyword(p, "menu digital", db_session)
    yesterday = date.today() - timedelta(days=1)
    db_session.add(SerpSnapshot(org_id=FAKE_ORG_ID, project_id=p.id, tracked_keyword_id=tk.id,
                                date=yesterday, position=8.0, url="https://pure-saveur.fr/p",
                                top10=[], features=[]))
    await db_session.commit()
    # today: not in top 100 -> drop from 8 to null (101) -> critical (left top 10)
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(None)))):
        await rts.snapshot_keyword(p, tk, db_session)
    a = (await db_session.execute(select(Alert).where(Alert.kind == "serp_drop"))).scalars().one()
    assert a.severity == "critical" and "/seo" in a.url and "menu digital" in a.title


@pytest.mark.asyncio
async def test_snapshot_gain_and_first_snapshot_silent(db_session):
    from app.services import serp_service, rank_tracking_service as rts
    p = await _mk_project(db_session)
    tk = await rts.add_keyword(p, "kw gain", db_session)
    # first snapshot: baseline, silent
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(None)))):
        await rts.snapshot_keyword(p, tk, db_session)
    assert (await db_session.execute(select(Alert))).scalars().first() is None
    # next day: enters at position 5 -> gain (101 -> 5)
    snap = (await db_session.execute(select(SerpSnapshot))).scalars().one()
    snap.date = date.today() - timedelta(days=1)
    await db_session.commit()
    with patch.object(serp_service, "get_seo_provider_for_org",
                      new=AsyncMock(return_value=_FakeProvider(_serp_items(5)))):
        await rts.snapshot_keyword(p, tk, db_session)
    g = (await db_session.execute(select(Alert).where(Alert.kind == "serp_gain"))).scalars().one()
    assert g.severity == "info"


@pytest.mark.asyncio
async def test_rank_tracker_cron_isolates_and_filters(db_session):
    from app.workers.tasks import seo_tasks
    p_ok = await _mk_project(db_session)
    from app.services import rank_tracking_service as rts
    await rts.add_keyword(p_ok, "kw", db_session)
    await _mk_project(db_session)  # no tracked keywords -> skipped
    calls = []

    async def fake_snapshot_project(project, db):
        calls.append(project.id)
        raise RuntimeError("boom")

    with patch.object(seo_tasks, "snapshot_project", new=fake_snapshot_project), \
         patch.object(seo_tasks, "async_session_factory", new=lambda: _single_session(db_session)):
        await seo_tasks.run_rank_tracker(None)
    assert calls == [p_ok.id]


# ── Task 5: /seo router (CRUD, history, refresh, provider-status, suggestions) ──

@pytest.mark.asyncio
async def test_seo_keyword_endpoints(client, db_session, org_and_project):
    p = await _mk_project(db_session)
    r = await client.get(f"/api/v1/seo/provider-status?project_id={p.id}")
    assert r.status_code == 200 and r.json()["connected"] in (True, False)
    r = await client.post("/api/v1/seo/keywords", json={"project_id": str(p.id), "keyword": "menu digital"})
    assert r.status_code == 201, r.text
    kid = r.json()["id"]
    r = await client.post("/api/v1/seo/keywords", json={"project_id": str(p.id), "keyword": "menu digital"})
    assert r.status_code == 409
    r = await client.post("/api/v1/seo/keywords", json={"project_id": str(uuid.uuid4()), "keyword": "x"})
    assert r.status_code == 404
    r = await client.get(f"/api/v1/seo/keywords?project_id={p.id}")
    assert len(r.json()) == 1 and r.json()[0]["keyword"] == "menu digital"
    r = await client.get(f"/api/v1/seo/keywords/{kid}/history?days=30")
    assert r.status_code == 200 and r.json()["keyword"] == "menu digital"
    r = await client.delete(f"/api/v1/seo/keywords/{kid}")
    assert r.status_code == 200
    r = await client.get(f"/api/v1/seo/keywords?project_id={p.id}")
    assert r.json() == []


@pytest.mark.asyncio
async def test_refresh_without_provider_returns_409_code(client, db_session, org_and_project, monkeypatch):
    from app.services import serp_service
    p = await _mk_project(db_session)
    r = await client.post("/api/v1/seo/keywords", json={"project_id": str(p.id), "keyword": "kw"})
    kid = r.json()["id"]
    with patch.object(serp_service, "get_seo_provider_for_org", new=AsyncMock(return_value=None)):
        r = await client.post(f"/api/v1/seo/keywords/{kid}/refresh")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_seo_provider"


# ── Task 7: content scoring vs live top-10 SERP ─────────────────────────────

@pytest.mark.asyncio
async def test_score_content_terms_and_structure(db_session):
    from app.services import content_scoring_service as css
    p = await _mk_project(db_session)
    serp = {"position": None, "url": None, "features": [],
            "top10": [{"rank": i, "domain": f"s{i}.com", "url": f"https://s{i}.com", "title": f"T{i}"} for i in range(1, 11)]}
    corpus = ("menu digital restaurant qr code carte restaurant menu digital "
              "prix menu digital exemple restaurant support") * 40  # ~ 4400 words total corpus
    async def fake_crawl(url):
        return {"text": corpus, "word_count": len(corpus.split()), "h2": ["A", "B", "C"], "title": "t"}
    my_text = "menu digital pour votre restaurant " * 30  # mentions some terms, misses others
    with patch.object(css, "fetch_serp", new=AsyncMock(return_value=serp)), \
         patch.object(css, "_crawl_page", new=fake_crawl), \
         patch.object(css, "call_llm", new=AsyncMock(return_value="Brief: add pricing section")):
        res = await css.score_content(p, "menu digital", db_session, text=my_text)
    assert 0 <= res["score"] <= 100
    statuses = {t["term"]: t["status"] for t in res["terms"]}
    assert "menu" in statuses and statuses.get("prix") in ("missing", "underused")
    assert res["structure"]["target_words"] > 0 and res["pages_analyzed"] == 5
    assert res["brief"] == "Brief: add pricing section"


@pytest.mark.asyncio
async def test_seo_score_endpoint_validation(client, db_session, org_and_project):
    from app.services import content_scoring_service as css
    p = await _mk_project(db_session)
    r = await client.post("/api/v1/seo/score", json={"project_id": str(p.id), "keyword": "menu digital"})
    assert r.status_code == 422
    with patch.object(css, "fetch_serp", new=AsyncMock(return_value=None)):
        r = await client.post("/api/v1/seo/score", json={
            "project_id": str(p.id), "keyword": "menu digital", "text": "some content"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "no_seo_provider"


@pytest.mark.asyncio
async def test_score_content_degrades_without_llm_and_partial_crawls(db_session):
    from app.services import content_scoring_service as css
    p = await _mk_project(db_session)
    serp = {"position": None, "url": None, "features": [],
            "top10": [{"rank": i, "domain": f"s{i}.com", "url": f"https://s{i}.com", "title": f"T{i}"} for i in range(1, 11)]}
    calls = {"n": 0}
    async def flaky_crawl(url):
        calls["n"] += 1
        if calls["n"] % 2 == 0:
            raise RuntimeError("crawl fail")
        return {"text": "menu digital " * 200, "word_count": 400, "h2": ["A"], "title": "t"}
    with patch.object(css, "fetch_serp", new=AsyncMock(return_value=serp)), \
         patch.object(css, "_crawl_page", new=flaky_crawl), \
         patch.object(css, "call_llm", new=AsyncMock(side_effect=RuntimeError("no key"))):
        res = await css.score_content(p, "menu digital", db_session, text="menu digital restaurant")
    assert res["brief"] is None and res["pages_analyzed"] >= 1
