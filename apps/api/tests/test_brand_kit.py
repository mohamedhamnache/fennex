import uuid
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.billing import OrgUsage, SubscriptionEvent  # noqa: F401
from app.models.organization import Organization, PlanTier
from app.models.user import User, UserRole

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "organizations",
    "users",
    "brand_kits",
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


@pytest.fixture
async def org(db_session):
    org = Organization(id=FAKE_ORG_ID, slug="test-org", name="Test Org", plan_tier=PlanTier.PRO)
    db_session.add(org)
    await db_session.commit()
    return org


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_brand_kit_defaults(client: AsyncClient, org):
    response = await client.get("/api/v1/brand-kit")
    assert response.status_code == 200
    data = response.json()
    assert data["colors"] == []
    assert data["logo_url"] is None
    assert data["primary_font"] is None


@pytest.mark.asyncio
async def test_update_brand_kit(client: AsyncClient, org):
    payload = {
        "colors": ["#1A2B3C", "#FF6B35"],
        "primary_font": "Inter",
        "style_rules": "Clean white backgrounds",
        "tone": "Premium and confident",
    }
    response = await client.put("/api/v1/brand-kit", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["colors"] == ["#1A2B3C", "#FF6B35"]
    assert data["primary_font"] == "Inter"


@pytest.mark.asyncio
async def test_update_brand_kit_is_idempotent(client: AsyncClient, org):
    await client.put("/api/v1/brand-kit", json={"colors": ["#AABBCC"]})
    response = await client.put("/api/v1/brand-kit", json={"colors": ["#112233"]})
    assert response.status_code == 200
    assert response.json()["colors"] == ["#112233"]
