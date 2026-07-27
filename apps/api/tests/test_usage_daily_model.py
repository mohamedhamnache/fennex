import uuid, datetime as dt, pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.usage_daily import UsageDaily

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)

async def test_usage_daily_roundtrip():
    org = uuid.uuid4()
    async with Session() as db:
        db.add(UsageDaily(day=dt.date(2026, 7, 26), org_id=org, provider="openai",
                          model="gpt-4o", unit="input_token", requests=3,
                          input_tokens=1000, output_tokens=200, cache_read_tokens=0,
                          seo_count=0, cost_micros=270))
        await db.commit()
        row = (await db.execute(select(UsageDaily))).scalar_one()
        assert row.cost_micros == 270 and row.input_tokens == 1000
