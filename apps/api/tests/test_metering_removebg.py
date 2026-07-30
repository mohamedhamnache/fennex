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
        db.add(CostRate(provider="removebg", unit="run", model="",
                        micro_dollars_per_unit=200_000))
        await db.commit()
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_record_removebg_writes_a_ledger_row_and_bumps_usage():
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_removebg(db, org_id=org, project_id=None,
                                           feature="auto_mask")
        assert cost == 200_000

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "edit"
        assert ev.provider == "removebg"
        assert ev.feature == "auto_mask"
        assert ev.cost_micros == 200_000

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.cost_micros == 200_000
        assert ou.ai_cost_micros == 200_000


async def test_record_removebg_bills_at_least_the_replicate_floor():
    """Remove.bg is a paid supplier call; a priced run never bills zero credits."""
    org = uuid.uuid4()
    async with Session() as db:
        await meter.record_removebg(db, org_id=org, project_id=None, feature="auto_mask")
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_credits_used >= 10


async def test_record_removebg_with_no_rate_costs_nothing_and_bills_nothing():
    """An unseeded rate must not silently bill the floor for a free call."""
    org = uuid.uuid4()
    async with Session() as db:
        await db.execute(CostRate.__table__.delete())
        await db.commit()
        cost = await meter.record_removebg(db, org_id=org, project_id=None)
        assert cost == 0

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_credits_used == 0
