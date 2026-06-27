import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.backlinks import (
    BacklinkProfile, Backlink, BacklinkOpportunity,
    ExchangeListing, ExchangeRequest, ExchangeMessage,
)

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DATABASE_URL, echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

@pytest.mark.asyncio
async def test_models_importable():
    for cls in [BacklinkProfile, Backlink, BacklinkOpportunity, ExchangeListing, ExchangeRequest, ExchangeMessage]:
        assert hasattr(cls, "__tablename__")

@pytest.mark.asyncio
async def test_backlink_profile_tablename():
    assert BacklinkProfile.__tablename__ == "backlink_profiles"

@pytest.mark.asyncio
async def test_exchange_request_tablename():
    assert ExchangeRequest.__tablename__ == "exchange_requests"
