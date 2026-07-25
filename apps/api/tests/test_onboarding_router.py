"""Tests for /api/v1/onboarding endpoints.

Strategy (mirrors test_billing_router.py / test_campaigns.py):
- Override `get_db` with an in-memory SQLite async session (aiosqlite)
- Override `get_current_user` with a fake user scoped to FAKE_ORG_ID
- Monkeypatch arq.create_pool so no test touches Redis
- Monkeypatch workspace_provisioning_service.provision so no test performs
  real embedding/LLM work
"""
import uuid

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app as fastapi_app
from app.models.discovery import DiscoveryRun
from app.models.organization import Organization
from app.models.user import User, UserRole

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

FAKE_ORG_ID = uuid.uuid4()
OTHER_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()


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
    return User(
        id=FAKE_USER_ID, org_id=FAKE_ORG_ID, email="test@fennex.ai",
        hashed_password="x", full_name="Test User", role=UserRole.OWNER, is_active=True,
    )


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with TestSessionLocal() as session:
        session.add(Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org"))
        session.add(Organization(id=OTHER_ORG_ID, slug="other-org", name="Other Org"))
        await session.commit()
    fastapi_app.dependency_overrides[get_db] = override_get_db
    fastapi_app.dependency_overrides[get_current_user] = override_get_current_user
    yield
    fastapi_app.dependency_overrides.clear()
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
def fake_enqueue(monkeypatch):
    """Stub arq.create_pool().enqueue_job so no test touches Redis. Records
    every call as (job_name, run_id_arg) for assertions."""
    import arq

    calls = []

    class _Pool:
        async def enqueue_job(self, *a, **k):
            calls.append(a)
            return None

        async def aclose(self):
            return None

    async def _fake_create_pool(*a, **k):
        return _Pool()

    monkeypatch.setattr(arq, "create_pool", _fake_create_pool)
    return calls


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as ac:
        yield ac


async def _seed_run(org_id: uuid.UUID, **kwargs) -> uuid.UUID:
    run_id = uuid.uuid4()
    defaults = dict(id=run_id, org_id=org_id, input_url="https://acme.test", result={})
    defaults.update(kwargs)
    async with TestSessionLocal() as session:
        session.add(DiscoveryRun(**defaults))
        await session.commit()
    return run_id


# -- POST /discovery + GET + PATCH lifecycle -----------------------------------

async def test_discovery_lifecycle(client, fake_enqueue):
    resp = await client.post(
        "/api/v1/onboarding/discovery",
        json={"url": "https://acme.test"},
        headers={"Authorization": "Bearer fake"},
    )
    assert resp.status_code == 200, resp.text
    run_id = resp.json()["run_id"]

    assert fake_enqueue == [("run_discovery", run_id)]

    got = await client.get(
        f"/api/v1/onboarding/discovery/{run_id}", headers={"Authorization": "Bearer fake"}
    )
    assert got.status_code == 200
    assert got.json()["status"] in ("queued", "running", "done")
    assert got.json()["id"] == run_id

    patched = await client.patch(
        f"/api/v1/onboarding/discovery/{run_id}",
        json={"result": {"business": {"name": "Edited"}}},
        headers={"Authorization": "Bearer fake"},
    )
    assert patched.status_code == 200
    assert patched.json()["result"]["business"]["name"] == "Edited"


async def test_start_discovery_requires_url_or_description(client, fake_enqueue):
    resp = await client.post(
        "/api/v1/onboarding/discovery", json={}, headers={"Authorization": "Bearer fake"}
    )
    assert resp.status_code == 400
    assert fake_enqueue == []


async def test_start_discovery_with_description_only(client, fake_enqueue):
    resp = await client.post(
        "/api/v1/onboarding/discovery",
        json={"description": "A boutique bakery in Nice."},
        headers={"Authorization": "Bearer fake"},
    )
    assert resp.status_code == 200, resp.text
    assert fake_enqueue == [("run_discovery", resp.json()["run_id"])]


# -- GET /discovery/{run_id} -----------------------------------------------------

async def test_get_discovery_not_found(client):
    resp = await client.get(
        f"/api/v1/onboarding/discovery/{uuid.uuid4()}", headers={"Authorization": "Bearer fake"}
    )
    assert resp.status_code == 404


async def test_get_discovery_cross_org_blocked(client):
    """A run belonging to another org must 404, not 403 -- ids must not be
    enumerable via a different status code."""
    other_run_id = await _seed_run(OTHER_ORG_ID)

    resp = await client.get(
        f"/api/v1/onboarding/discovery/{other_run_id}", headers={"Authorization": "Bearer fake"}
    )
    assert resp.status_code == 404


# -- PATCH /discovery/{run_id} ---------------------------------------------------

async def test_patch_discovery_cross_org_blocked(client):
    other_run_id = await _seed_run(OTHER_ORG_ID)

    resp = await client.patch(
        f"/api/v1/onboarding/discovery/{other_run_id}",
        json={"result": {"business": {"name": "Hijacked"}}},
        headers={"Authorization": "Bearer fake"},
    )
    assert resp.status_code == 404

    # The other org's run must be untouched.
    async with TestSessionLocal() as session:
        run = await session.get(DiscoveryRun, other_run_id)
        assert run.result == {}


async def test_patch_discovery_not_found(client):
    resp = await client.patch(
        f"/api/v1/onboarding/discovery/{uuid.uuid4()}",
        json={"result": {}},
        headers={"Authorization": "Bearer fake"},
    )
    assert resp.status_code == 404


# -- POST /provision ---------------------------------------------------------------

async def test_provision_workspace(client, monkeypatch):
    run_id = await _seed_run(FAKE_ORG_ID, result={"business": {"name": "Acme"}})
    project_id = uuid.uuid4()

    calls = []

    async def fake_provision(run_id_arg, *, persona, db):
        calls.append((run_id_arg, persona))
        return project_id

    monkeypatch.setattr(
        "app.api.v1.routers.onboarding.prov.provision", fake_provision
    )

    resp = await client.post(
        "/api/v1/onboarding/provision",
        json={"run_id": str(run_id), "persona": "ecommerce"},
        headers={"Authorization": "Bearer fake"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"project_id": str(project_id)}
    assert calls == [(run_id, "ecommerce")]


async def test_provision_not_found(client, monkeypatch):
    monkeypatch.setattr(
        "app.api.v1.routers.onboarding.prov.provision",
        pytest.fail,  # must never be called for an unowned/missing run
    )
    resp = await client.post(
        "/api/v1/onboarding/provision",
        json={"run_id": str(uuid.uuid4())},
        headers={"Authorization": "Bearer fake"},
    )
    assert resp.status_code == 404


async def test_provision_cross_org_blocked(client, monkeypatch):
    other_run_id = await _seed_run(OTHER_ORG_ID)

    monkeypatch.setattr(
        "app.api.v1.routers.onboarding.prov.provision",
        pytest.fail,  # must never be called for a run in a different org
    )

    resp = await client.post(
        "/api/v1/onboarding/provision",
        json={"run_id": str(other_run_id)},
        headers={"Authorization": "Bearer fake"},
    )
    assert resp.status_code == 404
