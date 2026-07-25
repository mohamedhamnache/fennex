import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.config import settings
from app.core.security import encrypt_value
from app.models.provider_account import ProviderAccount
from app.models.organization import Organization
from app.models.api_key import APIKey
from app.services.providers import registry
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


async def _org(db, *, byok=False):
    org = Organization(id=uuid.uuid4(), slug=f"o-{uuid.uuid4().hex[:6]}", name="Org",
                       byok_enabled=byok)
    db.add(org)
    await db.commit()
    return org.id


async def test_platform_llm_keys_from_account_then_env(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "env-openai", raising=False)
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "", raising=False)
    async with Session() as db:
        db.add(ProviderAccount(kind="llm", provider="anthropic", label="a",
                               encrypted_credentials=encrypt_value("acct-anthropic"),
                               priority=10))
        await db.commit()
        keys = await registry.platform_llm_keys(db)
    assert keys["anthropic"] == "acct-anthropic"   # from account
    assert keys["openai"] == "env-openai"           # from env bootstrap


async def test_get_llm_keys_ignores_org_key_without_byok(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "env-openai", raising=False)
    async with Session() as db:
        oid = await _org(db, byok=False)
        db.add(APIKey(id=uuid.uuid4(), org_id=oid, provider="openai",
                      encrypted_value=encrypt_value("tenant-openai")))
        await db.commit()
        keys = await registry.get_llm_keys(oid, db)
    assert keys["openai"] == "env-openai"           # platform wins; BYOK off


async def test_get_llm_keys_uses_org_key_with_byok(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "env-openai", raising=False)
    async with Session() as db:
        oid = await _org(db, byok=True)
        db.add(APIKey(id=uuid.uuid4(), org_id=oid, provider="openai",
                      encrypted_value=encrypt_value("tenant-openai")))
        await db.commit()
        keys = await registry.get_llm_keys(oid, db)
    assert keys["openai"] == "tenant-openai"        # BYOK override


async def test_resolve_seo_platform_first(monkeypatch):
    monkeypatch.setattr(settings, "DATAFORSEO_LOGIN", "", raising=False)
    monkeypatch.setattr(settings, "DATAFORSEO_PASSWORD", "", raising=False)
    async with Session() as db:
        oid = await _org(db, byok=False)
        db.add(ProviderAccount(kind="seo", provider="dataforseo", label="d",
                               encrypted_credentials=encrypt_value("plat-login:plat-pass")))
        await db.commit()
        prov = await registry.resolve_seo_provider(oid, db)
    assert isinstance(prov, DataForSEOProvider)


async def test_resolve_seo_none_when_unconfigured(monkeypatch):
    monkeypatch.setattr(settings, "DATAFORSEO_LOGIN", "", raising=False)
    monkeypatch.setattr(settings, "DATAFORSEO_PASSWORD", "", raising=False)
    async with Session() as db:
        oid = await _org(db, byok=False)
        prov = await registry.resolve_seo_provider(oid, db)
    assert prov is None


async def test_platform_llm_keys_lowest_priority_wins(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "", raising=False)
    async with Session() as db:
        db.add(ProviderAccount(kind="llm", provider="openai", label="low",
                               encrypted_credentials=encrypt_value("low-num-wins"),
                               priority=50))
        db.add(ProviderAccount(kind="llm", provider="openai", label="high",
                               encrypted_credentials=encrypt_value("higher-num-loses"),
                               priority=90))
        await db.commit()
        keys = await registry.platform_llm_keys(db)
    assert keys["openai"] == "low-num-wins"


async def test_resolve_seo_uses_tenant_key_with_byok(monkeypatch):
    monkeypatch.setattr(settings, "DATAFORSEO_LOGIN", "", raising=False)
    monkeypatch.setattr(settings, "DATAFORSEO_PASSWORD", "", raising=False)
    async with Session() as db:
        oid = await _org(db, byok=True)
        db.add(APIKey(id=uuid.uuid4(), org_id=oid, provider="dataforseo",
                      encrypted_value=encrypt_value("t-login:t-pass")))
        await db.commit()
        prov = await registry.resolve_seo_provider(oid, db)
    assert isinstance(prov, DataForSEOProvider)
    assert prov._auth == ("t-login", "t-pass")
