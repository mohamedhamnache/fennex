import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.config import settings
from app.core.security import encrypt_value
from app.models.organization import Organization
from app.models.provider_account import ProviderAccount
from app.integrations.seo_apis import get_seo_provider_for_org
from app.integrations.seo_apis.dataforseo import DataForSEOProvider

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_platform_account_used_without_tenant_key(monkeypatch):
    monkeypatch.setattr(settings, "DATAFORSEO_LOGIN", "", raising=False)
    monkeypatch.setattr(settings, "DATAFORSEO_PASSWORD", "", raising=False)
    async with Session() as db:
        org = Organization(id=uuid.uuid4(), slug="o", name="Org", byok_enabled=False)
        db.add(org)
        db.add(ProviderAccount(kind="seo", provider="dataforseo", label="d",
                               encrypted_credentials=encrypt_value("plat:pass")))
        await db.commit()
        prov = await get_seo_provider_for_org(org.id, db)
    assert isinstance(prov, DataForSEOProvider)
