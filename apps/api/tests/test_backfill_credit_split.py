import datetime as dt
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.billing import OrgUsage
from app.models.usage_event import UsageEvent
from scripts.backfill_credit_split import backfill_credit_split

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_backfill_splits_ai_cost_and_counts_seo_credits():
    org = uuid.uuid4()
    period = dt.date(2026, 7, 1)
    ts = dt.datetime(2026, 7, 10, tzinfo=dt.timezone.utc)
    async with Session() as db:
        db.add_all([
            UsageEvent(org_id=org, ts=ts, kind="llm", provider="openai",
                       model="gpt-4o-mini", cost_micros=2_000),
            UsageEvent(org_id=org, ts=ts, kind="image", provider="openai",
                       model="gpt-image-1", cost_micros=60_000),
            UsageEvent(org_id=org, ts=ts, kind="edit", provider="replicate",
                       model="x/y", cost_micros=10_000),
            UsageEvent(org_id=org, ts=ts, kind="seo", provider="dataforseo",
                       seo_unit="serp", seo_count=4, cost_micros=2_400),
            UsageEvent(org_id=org, ts=ts, kind="seo", provider="dataforseo",
                       seo_unit="audit", seo_count=1, cost_micros=3_000),
        ])
        await db.commit()

        assert await backfill_credit_split(db, period) == 1

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_cost_micros == 72_000   # llm + image + edit only
        assert ou.seo_credits_used == 18     # 4 serp x2 + 1 audit x10
        # ai_credits_used: llm 2_000 -> 2 (unfloored) + image 60_000 -> 58
        # (unfloored) + edit 10_000 -> 10 (Replicate floor, already at 10
        # unfloored so this case doesn't exercise it -- see the dedicated
        # floor tests below).
        assert ou.ai_credits_used == 70


async def test_backfill_floors_cheap_replicate_events_per_event():
    """The Replicate pricing floor must be applied to EACH event before
    summing, not to the org's total -- flooring the total would badly
    under-count an org with several cheap predictions."""
    org = uuid.uuid4()
    period = dt.date(2026, 7, 1)
    ts = dt.datetime(2026, 7, 10, tzinfo=dt.timezone.utc)
    async with Session() as db:
        db.add_all([
            UsageEvent(org_id=org, ts=ts, kind="edit", provider="replicate",
                       model="nightmareai/real-esrgan", cost_micros=2_000)
            for _ in range(3)
        ])
        await db.commit()

        assert await backfill_credit_split(db, period) == 1

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_cost_micros == 6_000   # true cost: unfloored, summed
        assert ou.ai_credits_used == 30     # 3 * MIN_REPLICATE_CREDITS -- per-event floor


async def test_backfill_does_not_floor_cheap_llm_events():
    """The floor is Replicate-only -- cheap LLM events must NOT be floored,
    even though they are just as cheap as the Replicate case above."""
    org = uuid.uuid4()
    period = dt.date(2026, 7, 1)
    ts = dt.datetime(2026, 7, 10, tzinfo=dt.timezone.utc)
    async with Session() as db:
        db.add_all([
            UsageEvent(org_id=org, ts=ts, kind="llm", provider="openai",
                       model="gpt-4o-mini", cost_micros=2_000)
            for _ in range(3)
        ])
        await db.commit()

        assert await backfill_credit_split(db, period) == 1

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_cost_micros == 6_000
        assert ou.ai_credits_used == 6   # 3 * credits_from_micros(2_000) == 3*2, unfloored
