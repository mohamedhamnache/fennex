import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.provider_account import ProviderAccount

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_provider_account_defaults():
    async with Session() as db:
        pa = ProviderAccount(kind="llm", provider="openai", label="primary",
                             encrypted_credentials="enc")
        db.add(pa)
        await db.commit()
        await db.refresh(pa)
        assert pa.is_active is True
        assert pa.priority == 100
