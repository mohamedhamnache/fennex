"""Router tests for Product-to-3D job enqueue + status endpoints.

Strategy mirrors tests/test_credit_enforcement.py: httpx ASGITransport against
the real app, get_db overridden with an in-memory SQLite session so no
migration needs to be applied here (Base.metadata.create_all builds the
schema straight from the models), get_current_user overridden with a fake
user for the happy-path / tenant-isolation / credit tests, and the real
(un-overridden) dependency for the no-token 401 case.
"""
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.billing import current_billing_period_start
from app.core.credits import PLAN_CREDITS
from app.core.database import Base, get_db
from app.core.dependencies import get_current_user
from app.main import app
from app.models.billing import OrgUsage
from app.models.organization import Organization, PlanTier
from app.models.project import Project
from app.models.product3d import Product3DJob, Product3DStatus
from app.models.user import User, UserRole

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "organizations", "users", "projects", "product3d_jobs", "org_usage",
]

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()
FAKE_PROJECT_ID = uuid.uuid4()

OTHER_ORG_ID = uuid.uuid4()

fake_user = User(
    id=FAKE_USER_ID, org_id=FAKE_ORG_ID, email="pas3d-test@fennex.ai",
    hashed_password="hashed", full_name="PAS 3D Test", role=UserRole.OWNER, is_active=True,
)


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


async def override_get_current_user():
    return fake_user


async def _seed(ai_credits_used: int = 0):
    tables = [Base.metadata.tables[name] for name in SQLITE_COMPATIBLE_TABLES if name in Base.metadata.tables]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    async with TestSessionLocal() as session:
        session.add(Organization(id=FAKE_ORG_ID, slug="pas3d-org", name="PAS 3D Org", plan_tier=PlanTier.STARTER))
        session.add(Organization(id=OTHER_ORG_ID, slug="pas3d-org-other", name="Other Org", plan_tier=PlanTier.STARTER))
        session.add(Project(id=FAKE_PROJECT_ID, org_id=FAKE_ORG_ID, name="Site", domain="site.example"))
        session.add(OrgUsage(
            org_id=FAKE_ORG_ID, period_start=current_billing_period_start(),
            ai_credits_used=ai_credits_used,
        ))
        await session.commit()


async def _teardown():
    tables = [Base.metadata.tables[name] for name in SQLITE_COMPATIBLE_TABLES if name in Base.metadata.tables]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, tables=tables)


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
async def unauth_client():
    """Only get_db is overridden -- auth runs for real, so a request with no
    Authorization header exercises the genuine 401 path."""
    app.dependency_overrides[get_db] = override_get_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Mock ARQ pool (POST enqueues run_product_3d; no real Redis in tests) ──────

def make_mock_pool():
    pool = AsyncMock()
    pool.enqueue_job = AsyncMock(return_value=MagicMock())
    pool.aclose = AsyncMock()
    return pool


def _payload(**overrides):
    body = {
        "project_id": str(FAKE_PROJECT_ID),
        "source_image_url": "https://cdn.fennex.ai/products/sneaker.png",
        "quality": "high",
        "texture_resolution": "2K",
        "formats": ["glb", "obj"],
    }
    body.update(overrides)
    return body


# ── POST /images/product-3d ──────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_enqueue_returns_202_with_job_id_and_creates_pending_row(client):
    await _seed()
    try:
        mock_pool = make_mock_pool()
        with patch("app.api.v1.routers.product3d.arq.create_pool", return_value=mock_pool):
            resp = await client.post("/api/v1/images/product-3d", json=_payload())
        assert resp.status_code == 202
        data = resp.json()
        assert "job_id" in data
        job_id = uuid.UUID(data["job_id"])

        async with TestSessionLocal() as session:
            job = await session.get(Product3DJob, job_id)
            assert job is not None
            assert job.status == Product3DStatus.pending
            assert job.org_id == FAKE_ORG_ID
            assert job.project_id == FAKE_PROJECT_ID
            assert job.requested_formats == ["glb", "obj"]
            assert job.quality == "high"
            assert job.texture_resolution == "2K"

        mock_pool.enqueue_job.assert_awaited_once_with("run_product_3d", str(job_id))
    finally:
        await _teardown()


@pytest.mark.asyncio
async def test_enqueue_unsupported_format_is_422(client):
    await _seed()
    try:
        resp = await client.post("/api/v1/images/product-3d", json=_payload(formats=["fbx"]))
        assert resp.status_code == 422
    finally:
        await _teardown()


@pytest.mark.asyncio
async def test_enqueue_unknown_project_is_404(client):
    await _seed()
    try:
        resp = await client.post("/api/v1/images/product-3d", json=_payload(project_id=str(uuid.uuid4())))
        assert resp.status_code == 404
    finally:
        await _teardown()


@pytest.mark.asyncio
async def test_enqueue_without_token_is_401(unauth_client):
    await _seed()
    try:
        resp = await unauth_client.post("/api/v1/images/product-3d", json=_payload())
        assert resp.status_code == 401
    finally:
        await _teardown()


@pytest.mark.asyncio
async def test_enqueue_maxed_out_org_is_429(client):
    """require_credits("ai") actually guards the enqueue endpoint."""
    await _seed(ai_credits_used=PLAN_CREDITS["starter"])
    try:
        resp = await client.post("/api/v1/images/product-3d", json=_payload())
        assert resp.status_code == 429
        detail = resp.json()["detail"]
        assert detail["code"] == "LIMIT_REACHED"
        assert detail["bucket"] == "ai"
    finally:
        await _teardown()


# ── GET /images/product-3d/{job_id} ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_status_returns_the_row(client):
    await _seed()
    try:
        with patch("app.api.v1.routers.product3d.arq.create_pool", return_value=make_mock_pool()):
            enqueue_resp = await client.post("/api/v1/images/product-3d", json=_payload())
        job_id = enqueue_resp.json()["job_id"]

        resp = await client.get(f"/api/v1/images/product-3d/{job_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["job_id"] == job_id
        assert data["status"] == "pending"
        assert data["formats"] == ["glb", "obj"]
        assert data["output_urls"] == {}
        assert data["error"] is None
        assert data["quality"] == "high"
        assert data["texture_resolution"] == "2K"
    finally:
        await _teardown()


@pytest.mark.asyncio
async def test_status_unknown_job_is_404(client):
    await _seed()
    try:
        resp = await client.get(f"/api/v1/images/product-3d/{uuid.uuid4()}")
        assert resp.status_code == 404
    finally:
        await _teardown()


@pytest.mark.asyncio
async def test_status_other_org_job_is_404(client):
    """Tenant isolation: a job belonging to another org must not be readable."""
    await _seed()
    try:
        async with TestSessionLocal() as session:
            other_job = Product3DJob(
                org_id=OTHER_ORG_ID,
                project_id=uuid.uuid4(),
                source_image_url="https://cdn.fennex.ai/products/other.png",
                status=Product3DStatus.pending,
                requested_formats=["glb"],
            )
            session.add(other_job)
            await session.commit()
            other_job_id = other_job.id

        resp = await client.get(f"/api/v1/images/product-3d/{other_job_id}")
        assert resp.status_code == 404
    finally:
        await _teardown()


@pytest.mark.asyncio
async def test_status_without_token_is_401(unauth_client):
    await _seed()
    try:
        resp = await unauth_client.get(f"/api/v1/images/product-3d/{uuid.uuid4()}")
        assert resp.status_code == 401
    finally:
        await _teardown()
