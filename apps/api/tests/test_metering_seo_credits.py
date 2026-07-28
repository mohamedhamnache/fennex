import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.billing import OrgUsage
from app.models.cost_rate import CostRate
from app.models.usage_event import UsageEvent
from app.services.metering import meter

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add_all([
            CostRate(provider="dataforseo", unit="serp", model="", micro_dollars_per_unit=600),
            CostRate(provider="dataforseo", unit="audit", model="", micro_dollars_per_unit=3_000),
        ])
        await db.commit()
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_record_seo_counts_one_credit_per_task():
    org = uuid.uuid4()
    async with Session() as db:
        await meter.record_seo(db, org_id=org, project_id=None, unit="serp", count=3)
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.seo_credits_used == 6  # 3 serp tasks x weight 2
        assert ou.cost_micros == 1_800


async def test_heavy_units_are_weighted():
    org = uuid.uuid4()
    async with Session() as db:
        await meter.record_seo(db, org_id=org, project_id=None, unit="audit", count=2)
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.seo_credits_used == 20  # 2 audits x weight 10


async def test_seo_spend_does_not_consume_the_ai_bucket():
    org = uuid.uuid4()
    async with Session() as db:
        await meter.record_seo(db, org_id=org, project_id=None, unit="serp", count=5)
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_cost_micros == 0


async def test_record_seo_bill_credits_false_meters_cost_without_crediting():
    """Background/cron SEO work (bill_credits=False) must still be visible for
    COGS/margin reporting -- a usage_event is written and cost_micros is
    bumped -- but must NOT touch seo_credits_used, so it can never trip the
    enforced bucket a user-initiated call would hit."""
    org = uuid.uuid4()
    async with Session() as db:
        await meter.record_seo(db, org_id=org, project_id=None, unit="serp", count=3,
                               bill_credits=False)
        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalars().one()
        assert ev.cost_micros == 1_800
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.cost_micros == 1_800
        assert ou.seo_serp == 3  # the non-credit counters still accumulate
        assert ou.seo_credits_used == 0


async def test_record_seo_bill_credits_default_true_bills_as_before():
    org = uuid.uuid4()
    async with Session() as db:
        await meter.record_seo(db, org_id=org, project_id=None, unit="serp", count=3)
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.seo_credits_used == 6
