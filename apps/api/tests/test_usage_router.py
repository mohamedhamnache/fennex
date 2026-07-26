import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.billing import current_billing_period_start
from app.core.dependencies import get_current_user, get_db
from app.main import app as fastapi_app
from app.models.organization import Organization
from app.models.user import User, UserRole
from app.models.billing import OrgUsage

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


def _user():
    return User(id=uuid.uuid4(), org_id=ORG, email="u@x.com", hashed_password="x",
                full_name="U", role=UserRole.OWNER, is_active=True)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as s:
        s.add(Organization(id=ORG, slug="o", name="Org"))
        s.add(OrgUsage(org_id=ORG, period_start=current_billing_period_start(),
                       ai_input_tokens=1000, ai_requests=2, cost_micros=2_500_000))
        await s.commit()
    fastapi_app.dependency_overrides[get_db] = override_get_db
    fastapi_app.dependency_overrides[get_current_user] = _user
    yield
    fastapi_app.dependency_overrides.clear()
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=fastapi_app), base_url="http://test") as ac:
        yield ac


async def test_usage_summary(client):
    r = await client.get("/api/v1/usage/summary")
    assert r.status_code == 200
    body = r.json()
    assert body["ai_input_tokens"] == 1000
    assert body["ai_requests"] == 2
    assert body["cost_micros"] == 2_500_000
    assert body["cost_usd"] == 2.5
