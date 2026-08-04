"""Cost rates for the two models introduced by the canvas-accuracy change.

An unrated model bills NOTHING at the per-run fallback's worst case and
silently inherits the generic per-second default at its best, so the rate must
land in the same migration that introduces the model. Mirrors
tests/test_metering_new_models.py.

Rates, read off each model's own Replicate page on 2026-08-04:
  lucataco/florence-2-large   Nvidia L40S         $0.000975/sec
  men1scus/birefnet           Nvidia A100 (80GB)  $0.001400/sec
"""
import pathlib
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.cost_rate import CostRate
from app.models.usage_event import UsageEvent
from app.services.metering import meter

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

_FLORENCE = "lucataco/florence-2-large"
_FLORENCE_RATE = 975  # Nvidia L40S

_BIREFNET = "men1scus/birefnet"
_BIREFNET_RATE = 1_400  # Nvidia A100 80GB

VERSIONS = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions"


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add_all([
            CostRate(provider="replicate", unit="second", model=_FLORENCE,
                     micro_dollars_per_unit=_FLORENCE_RATE),
            CostRate(provider="replicate", unit="second", model=_BIREFNET,
                     micro_dollars_per_unit=_BIREFNET_RATE),
            # The generic fallback exists in production (z7persecond4); keeping
            # it here means a lookup miss would be masked, exactly as it would
            # be in production, rather than raising and flagging itself.
            CostRate(provider="replicate", unit="second", model="",
                     micro_dollars_per_unit=1_400),
        ])
        await db.commit()
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_florence_rate_resolves_to_its_own_l40s_row():
    async with Session() as db:
        resolved = await meter.rate(db, "replicate", "second", _FLORENCE)
        assert resolved == _FLORENCE_RATE
        assert resolved != 1_400  # would over-charge on the generic A100 default


async def test_birefnet_rate_resolves_to_its_seeded_row():
    async with Session() as db:
        assert await meter.rate(db, "replicate", "second", _BIREFNET) == _BIREFNET_RATE


async def test_a_metered_florence_call_prices_from_real_predict_time():
    """2.246580753s is the predict_time Replicate's own API reports for this
    model's default example -- an observed duration, not a guess."""
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model=_FLORENCE,
            feature="image_edit", predict_seconds=2.246580753,
        )
        assert cost == round(2.246580753 * _FLORENCE_RATE)
        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.provider == "replicate"
        assert ev.model == _FLORENCE


def test_both_models_are_seeded_by_a_migration():
    """An unrated model bills nothing. The rate must ship with the model, not
    after it."""
    seeding = [
        p.name for p in VERSIONS.glob("*.py")
        if "INSERT INTO cost_rates" in (text := p.read_text())
        and _FLORENCE in text and _BIREFNET in text
    ]
    assert seeding, (
        f"no migration seeds cost rates for {_FLORENCE} and {_BIREFNET}; an "
        "unrated model inherits the generic default and prices nothing"
    )
