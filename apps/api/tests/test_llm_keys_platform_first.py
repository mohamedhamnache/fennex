import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.config import settings
from app.models.organization import Organization
from app.services.llm_service import get_org_llm_keys

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_get_org_llm_keys_returns_platform_keys(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "env-openai", raising=False)
    async with Session() as db:
        org = Organization(id=uuid.uuid4(), slug="o", name="Org", byok_enabled=False)
        db.add(org)
        await db.commit()
        keys = await get_org_llm_keys(org.id, db)
    assert keys.get("openai") == "env-openai"   # platform key, no tenant key needed
