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
            CostRate(provider="replicate", unit="run",
                     model="852-labs/background-remover", micro_dollars_per_unit=10_000),
            CostRate(provider="replicate", unit="run", model="", micro_dollars_per_unit=5_000),
            # Nvidia A100 80GB, Replicate's published per-second price.
            CostRate(provider="replicate", unit="second", model="", micro_dollars_per_unit=1_400),
        ])
        await db.commit()
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_record_replicate_prices_from_model_rate():
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None,
            model="852-labs/background-remover", feature="background_removal",
        )
        assert cost == 10_000

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "edit"
        assert ev.provider == "replicate"
        assert ev.model == "852-labs/background-remover"
        assert ev.cost_micros == 10_000

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_cost_micros == 10_000
        # 10_000 micros -> credits_from_micros gives exactly 10: already at
        # the floor, so this case alone can't distinguish floored from not.
        assert ou.ai_credits_used == 10


async def test_record_replicate_falls_back_to_default_rate():
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model="some/unpriced-model",
        )
        assert cost == 5_000


async def test_record_replicate_floors_cheap_predictions_to_minimum_credits():
    """A cheap Replicate model (e.g. real-esrgan/codeformer class) costs a
    few GPU-seconds -- well under one credit's worth -- but must still bill
    the 10-credit floor. cost_micros/ai_cost_micros stay the TRUE unfloored
    cost; only the credit counter is floored."""
    org = uuid.uuid4()
    async with Session() as db:
        db.add(CostRate(provider="replicate", unit="run",
                        model="nightmareai/real-esrgan", micro_dollars_per_unit=2_500))
        await db.commit()

        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model="nightmareai/real-esrgan",
        )
        assert cost == 2_500  # true cost: unfloored

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.cost_micros == 2_500  # ledger keeps the true cost too

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_cost_micros == 2_500  # true cost subtotal: still unfloored
        assert ou.ai_credits_used == 10    # credits_from_micros(2_500) == 3, floored to 10


async def test_cost_tracks_actual_compute_time_not_a_flat_fee():
    """A long run must cost more than a short one.

    Replicate bills community models by GPU-second and reports the real
    duration, so a draft/2K Trellis job and an ultra/8K one must not bill the
    same -- which is exactly what a single per-run rate did.
    """
    short_org, long_org = uuid.uuid4(), uuid.uuid4()
    async with Session() as db:
        short = await meter.record_replicate(
            db, org_id=short_org, project_id=None, model="firtoz/trellis",
            predict_seconds=9.0,
        )
        long = await meter.record_replicate(
            db, org_id=long_org, project_id=None, model="firtoz/trellis",
            predict_seconds=75.0,
        )
        assert short == round(9.0 * 1_400)
        assert long == round(75.0 * 1_400)
        assert long > short * 5


async def test_falls_back_to_the_per_run_rate_without_a_duration():
    """Callers that cannot report a duration keep the previous behaviour."""
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model="some/unpriced-model",
        )
        assert cost == 5_000
