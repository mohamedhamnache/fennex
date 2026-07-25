import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.discovery import DiscoveryRun

test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def test_discovery_run_defaults():
    async with TestSessionLocal() as db:
        run = DiscoveryRun(org_id=uuid.uuid4(), input_url="https://example.com", result={})
        db.add(run)
        await db.commit()
        await db.refresh(run)
        assert run.status == "queued"
        assert run.progress == 0
        assert run.result == {}
