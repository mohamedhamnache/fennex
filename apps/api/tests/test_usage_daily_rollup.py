import uuid, datetime as dt, pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.usage_event import UsageEvent
from app.models.usage_daily import UsageDaily
from app.services.admin.rollup import rollup_usage_daily

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)

async def test_rollup_aggregates_and_is_idempotent():
    org = uuid.uuid4()
    day = dt.date(2026, 7, 26)
    ts = dt.datetime(2026, 7, 26, 10, 0, tzinfo=dt.timezone.utc)
    async with Session() as db:
        db.add_all([
            UsageEvent(org_id=org, kind="llm", provider="openai", model="gpt-4o",
                       input_tokens=1000, output_tokens=200, cache_read_tokens=0,
                       cost_micros=120, ts=ts),
            UsageEvent(org_id=org, kind="llm", provider="openai", model="gpt-4o",
                       input_tokens=500, output_tokens=100, cache_read_tokens=0,
                       cost_micros=60, ts=ts),
            UsageEvent(org_id=org, kind="seo", provider="dataforseo", seo_unit="serp",
                       seo_count=3, cost_micros=4500, ts=ts),
        ])
        await db.commit()
        n = await rollup_usage_daily(db, day)
        assert n >= 2
        llm = (await db.execute(select(UsageDaily).where(
            UsageDaily.provider == "openai", UsageDaily.unit == "llm"))).scalar_one()
        assert llm.requests == 2 and llm.input_tokens == 1500 and llm.cost_micros == 180
        seo = (await db.execute(select(UsageDaily).where(
            UsageDaily.provider == "dataforseo"))).scalar_one()
        assert seo.seo_count == 3 and seo.cost_micros == 4500
        # idempotency: second run must not double count
        await rollup_usage_daily(db, day)
        llm2 = (await db.execute(select(UsageDaily).where(
            UsageDaily.provider == "openai", UsageDaily.unit == "llm"))).scalar_one()
        assert llm2.cost_micros == 180 and llm2.requests == 2
