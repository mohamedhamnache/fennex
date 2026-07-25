import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.config import settings
from app.core.dependencies import get_current_user, get_db
from app.main import app as fastapi_app
from app.models.organization import Organization
from app.models.user import User, UserRole

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
ORG = uuid.uuid4()


async def override_get_db():
    async with Session() as s:
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise


def _user(email):
    return User(id=uuid.uuid4(), org_id=ORG, email=email, hashed_password="x",
                full_name="U", role=UserRole.OWNER, is_active=True)


@pytest.fixture(autouse=True)
async def setup_db(monkeypatch):
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as s:
        s.add(Organization(id=ORG, slug="o", name="Org"))
        await s.commit()
    monkeypatch.setattr(settings, "PLATFORM_ADMIN_EMAILS", ["staff@fennex.ai"], raising=False)
    fastapi_app.dependency_overrides[get_db] = override_get_db
    yield
    fastapi_app.dependency_overrides.clear()
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as ac:
        yield ac


async def test_non_staff_forbidden(client):
    fastapi_app.dependency_overrides[get_current_user] = lambda: _user("user@x.com")
    r = await client.get("/api/v1/admin/provider-accounts")
    assert r.status_code == 403


async def test_staff_create_and_list_masks_secret(client):
    fastapi_app.dependency_overrides[get_current_user] = lambda: _user("staff@fennex.ai")
    r = await client.post("/api/v1/admin/provider-accounts", json={
        "kind": "llm", "provider": "openai", "label": "primary",
        "credentials": "sk-secret-123456",
    })
    assert r.status_code == 201
    body = r.json()
    assert "secret" not in str(body).lower() or body["credentials_hint"].endswith("3456")
    assert "sk-secret-123456" not in str(body)  # raw secret never returned
    lst = await client.get("/api/v1/admin/provider-accounts")
    assert lst.status_code == 200
    assert lst.json()[0]["provider"] == "openai"
