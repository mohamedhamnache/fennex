"""
Tests for keyword research endpoints and worker task.

Strategy:
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user
- Mock arq.create_pool so no real Redis is needed
- Test the worker task directly using the mock provider
"""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User, UserRole
from app.models.keyword import KeywordResearchJob, Keyword, KeywordCluster, ResearchStatus

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)


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


# ── Fake user fixture ─────────────────────────────────────────────────────────

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()
FAKE_PROJECT_ID = uuid.uuid4()

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


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
async def setup_db():
    """Create all tables before each test and drop after."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def db_session():
    """Direct DB session for setting up test data."""
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def org_and_project(db_session):
    """Create an org and project in the test DB."""
    org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org")
    db_session.add(org)
    await db_session.flush()

    project = Project(
        id=FAKE_PROJECT_ID,
        org_id=FAKE_ORG_ID,
        name="Test Project",
        domain="example.com",
    )
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


# ── Mock ARQ pool ─────────────────────────────────────────────────────────────

def make_mock_pool():
    pool = AsyncMock()
    pool.enqueue_job = AsyncMock(return_value=MagicMock())
    pool.aclose = AsyncMock()
    return pool


# ── Endpoint Tests ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_trigger_keyword_research(client, org_and_project):
    """POST /keywords/research creates a job and enqueues the ARQ task."""
    mock_pool = make_mock_pool()
    with patch("app.api.v1.routers.keywords.arq.create_pool", return_value=mock_pool):
        response = await client.post(
            "/api/v1/keywords/research",
            json={"project_id": str(FAKE_PROJECT_ID), "seed_keyword": "seo tools"},
        )

    assert response.status_code == 202
    data = response.json()
    assert "job_id" in data
    assert data["status"] == "pending"
    mock_pool.enqueue_job.assert_awaited_once_with("run_keyword_research", data["job_id"])


@pytest.mark.asyncio
async def test_trigger_research_project_not_found(client, org_and_project):
    """POST /keywords/research returns 404 when project doesn't belong to org."""
    mock_pool = make_mock_pool()
    with patch("app.api.v1.routers.keywords.arq.create_pool", return_value=mock_pool):
        response = await client.post(
            "/api/v1/keywords/research",
            json={"project_id": str(uuid.uuid4()), "seed_keyword": "seo tools"},
        )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_get_research_job_status(client, org_and_project, db_session):
    """GET /keywords/research/{job_id} returns job status."""
    job = KeywordResearchJob(
        org_id=FAKE_ORG_ID,
        project_id=FAKE_PROJECT_ID,
        seed_keyword="seo tools",
        status=ResearchStatus.completed,
        keywords_found=20,
    )
    db_session.add(job)
    await db_session.commit()

    response = await client.get(f"/api/v1/keywords/research/{job.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "completed"
    assert data["keywords_found"] == 20
    assert data["seed_keyword"] == "seo tools"


@pytest.mark.asyncio
async def test_get_research_job_not_found(client, org_and_project):
    """GET /keywords/research/{job_id} returns 404 for unknown job."""
    response = await client.get(f"/api/v1/keywords/research/{uuid.uuid4()}")
    assert response.status_code == 404


# ── Worker Task Tests ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_run_keyword_research_task():
    """
    Test the ARQ worker task end-to-end with the mock provider.
    Inserts a KeywordResearchJob, calls the task, verifies keywords and clusters are created.
    """
    from app.workers.tasks.keyword_tasks import run_keyword_research

    # Setup: create org, project, and job in test DB
    async with TestSessionLocal() as session:
        org = Organization(id=FAKE_ORG_ID, slug="worker-test-org", name="Worker Test Org")
        session.add(org)
        await session.flush()

        project = Project(
            id=FAKE_PROJECT_ID,
            org_id=FAKE_ORG_ID,
            name="Worker Project",
            domain="worker.com",
        )
        session.add(project)
        await session.flush()

        job = KeywordResearchJob(
            org_id=FAKE_ORG_ID,
            project_id=FAKE_PROJECT_ID,
            seed_keyword="python",
            status=ResearchStatus.pending,
        )
        session.add(job)
        await session.commit()
        job_id = str(job.id)

    # Patch async_session_factory in the worker task module to use the test DB
    with patch("app.workers.tasks.keyword_tasks.async_session_factory", TestSessionLocal):
        await run_keyword_research(ctx={}, job_id=job_id)

    # Verify outcomes
    from sqlalchemy import select
    async with TestSessionLocal() as session:
        # Job should be completed
        refreshed_job = await session.get(KeywordResearchJob, uuid.UUID(job_id))
        assert refreshed_job.status == ResearchStatus.completed
        assert refreshed_job.keywords_found == 20  # mock returns 20 variants

        # Keywords should be created
        kw_result = await session.execute(
            select(Keyword).where(Keyword.job_id == uuid.UUID(job_id))
        )
        keywords = kw_result.scalars().all()
        assert len(keywords) == 20

        # All keywords have search_volume, difficulty, cpc
        for kw in keywords:
            assert kw.search_volume is not None
            assert kw.difficulty is not None
            assert kw.cpc is not None
            assert kw.intent is not None
            assert kw.cluster_id is not None

        # Clusters should be created
        cl_result = await session.execute(
            select(KeywordCluster).where(KeywordCluster.job_id == uuid.UUID(job_id))
        )
        clusters = cl_result.scalars().all()
        assert len(clusters) > 0

        # Check cluster_count correctness
        for cluster in clusters:
            assert cluster.keyword_count > 0


@pytest.mark.asyncio
async def test_run_keyword_research_task_missing_job():
    """Worker task with a non-existent job_id returns early without error."""
    from app.workers.tasks.keyword_tasks import run_keyword_research

    # Setup: only create the schema, no job row
    with patch("app.workers.tasks.keyword_tasks.async_session_factory", TestSessionLocal):
        # Should return None without raising
        result = await run_keyword_research(ctx={}, job_id=str(uuid.uuid4()))
    assert result is None


# ── Clustering Unit Tests ─────────────────────────────────────────────────────

def test_cluster_keywords():
    from app.services.keyword_service import cluster_keywords
    kws = ["python tutorial", "python guide", "java tutorial", "java examples"]
    clusters = cluster_keywords(kws)
    assert "python" in clusters
    assert "java" in clusters
    assert set(clusters["python"]) == {"python tutorial", "python guide"}
    assert set(clusters["java"]) == {"java tutorial", "java examples"}


def test_get_cluster_key_for_stopword_handling():
    from app.services.keyword_service import _get_cluster_key_for
    # "best" is a stopword — should skip to "seo"
    assert _get_cluster_key_for("best seo tools") == "seo"
    # "how to" — stopwords, should fall back to next significant token
    assert _get_cluster_key_for("how to optimize") == "optimize"


def test_mock_provider_deterministic():
    """Same seed always returns same data."""
    import asyncio
    from app.integrations.seo_apis.mock_provider import MockSEOProvider

    provider = MockSEOProvider()

    async def run():
        r1 = await provider.get_keyword_ideas("python")
        r2 = await provider.get_keyword_ideas("python")
        return r1, r2

    r1, r2 = asyncio.run(run())
    assert len(r1) == 20
    for a, b in zip(r1, r2):
        assert a.keyword == b.keyword
        assert a.search_volume == b.search_volume
        assert a.difficulty == b.difficulty
        assert a.cpc == b.cpc
        assert a.intent == b.intent


def test_classify_intent():
    from app.integrations.seo_apis.base import _classify_intent
    assert _classify_intent("buy seo tools") == "transactional"
    assert _classify_intent("best seo software") == "commercial"
    assert _classify_intent("how to do seo") == "informational"
    assert _classify_intent("seo") == "navigational"
    assert _classify_intent("seo pricing") == "transactional"
    assert _classify_intent("seo review") == "commercial"
