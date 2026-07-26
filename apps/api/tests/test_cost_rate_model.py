import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.cost_rate import CostRate

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_cost_rate_roundtrip():
    async with Session() as db:
        r = CostRate(provider="openai", unit="input_token", model="gpt-4o-mini",
                     micro_dollars_per_unit=0.15)
        db.add(r)
        await db.commit()
        await db.refresh(r)
        assert r.micro_dollars_per_unit == 0.15
        assert r.effective_from is not None
