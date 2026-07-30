"""Cover the two per-second cost_rates seeded by
alembic/versions/s4lamasam9_lama_langsam_cost_rates.py for allenhooo/lama
(object removal / smart erase) and tmappdev/lang-segment-anything (prompted
mask segmentation) -- both previously fell through to the generic
replicate/second/'' rate, which was only right for one of them by
coincidence. Mirrors the pattern in test_metering_replicate.py."""
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

_LAMA = "allenhooo/lama"
_LAMA_RATE = 225  # Nvidia T4, $0.000225/sec (w3repricing7's T4 figure)

_LANG_SAM = "tmappdev/lang-segment-anything"
_LANG_SAM_RATE = 1_400  # Nvidia A100 80GB, $0.0014/sec


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add_all([
            CostRate(provider="replicate", unit="second", model=_LAMA,
                     micro_dollars_per_unit=_LAMA_RATE),
            CostRate(provider="replicate", unit="second", model=_LANG_SAM,
                     micro_dollars_per_unit=_LANG_SAM_RATE),
            # Generic fallback, present in production (z7persecond4) -- kept
            # here so a lookup miss on the model-specific row would be masked
            # by the fallback rather than erroring, exactly like production.
            CostRate(provider="replicate", unit="second", model="",
                     micro_dollars_per_unit=1_400),
        ])
        await db.commit()
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_lama_rate_resolves_to_the_seeded_t4_rate_not_the_generic_default():
    async with Session() as db:
        resolved = await meter.rate(db, "replicate", "second", _LAMA)
        assert resolved == _LAMA_RATE
        assert resolved != 1_400  # would silently mis-price on the generic A100 default


async def test_lang_sam_rate_resolves_to_its_seeded_row():
    async with Session() as db:
        resolved = await meter.rate(db, "replicate", "second", _LANG_SAM)
        assert resolved == _LANG_SAM_RATE


async def test_lama_metered_call_prices_from_real_predict_time():
    """4.275178s is the predict_time Replicate's own API reports for this
    model's default example -- a real observed duration, not a guess."""
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model=_LAMA,
            feature="smart_erase", predict_seconds=4.275178,
        )
        assert cost == round(4.275178 * _LAMA_RATE)

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "edit"
        assert ev.provider == "replicate"
        assert ev.model == _LAMA
        assert ev.cost_micros == cost

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_cost_micros == cost  # true cost, unfloored
        # A sub-cent T4 run is well under one credit's worth -- the
        # Replicate pricing floor kicks in.
        assert ou.ai_credits_used == 10


async def test_lang_sam_metered_call_prices_from_real_predict_time():
    """2.236687529s is the predict_time Replicate's own API reports for this
    model's default example."""
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model=_LANG_SAM,
            feature="mask_segmentation", predict_seconds=2.236687529,
        )
        assert cost == round(2.236687529 * _LANG_SAM_RATE)

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "edit"
        assert ev.provider == "replicate"
        assert ev.model == _LANG_SAM
        assert ev.cost_micros == cost

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_cost_micros == cost
        assert ou.ai_credits_used == 10  # also under the floor at this duration


async def test_a_longer_lama_run_costs_proportionally_more():
    """Same model, longer duration -- cost must scale with predict_seconds,
    not be a flat per-run fee (that's the whole point of the per-second
    rate over a per-run one for this model)."""
    short_org, long_org = uuid.uuid4(), uuid.uuid4()
    async with Session() as db:
        short = await meter.record_replicate(
            db, org_id=short_org, project_id=None, model=_LAMA, predict_seconds=3.0,
        )
        long = await meter.record_replicate(
            db, org_id=long_org, project_id=None, model=_LAMA, predict_seconds=30.0,
        )
        assert short == round(3.0 * _LAMA_RATE)
        assert long == round(30.0 * _LAMA_RATE)
        assert long == short * 10


async def test_per_image_pricing_wins_over_duration_for_official_image_models():
    """Replicate bills its OFFICIAL image models per output image, not per
    GPU-second. nano-banana runs in ~5s, so the per-second path would bill
    ~7500 micro-$ for an edit costing several times that -- an invisible margin
    loss on every call."""
    org = uuid.uuid4()
    async with Session() as db:
        db.add(CostRate(provider="replicate", unit="image",
                        model="google/nano-banana", micro_dollars_per_unit=39_000))
        await db.commit()

        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model="google/nano-banana",
            feature="instruction_edit", predict_seconds=5.38, image_count=1,
        )
        assert cost == 39_000, "must price per image, not 5.38s x 1400"


async def test_two_output_images_cost_twice():
    org = uuid.uuid4()
    async with Session() as db:
        db.add(CostRate(provider="replicate", unit="image",
                        model="google/nano-banana", micro_dollars_per_unit=39_000))
        await db.commit()
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model="google/nano-banana",
            predict_seconds=5.0, image_count=2,
        )
        assert cost == 78_000


async def test_a_model_without_an_image_rate_still_bills_per_second():
    """Community models are unaffected: no replicate/image row, no new branch."""
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model="allenhooo/lama",
            predict_seconds=2.0, image_count=1,
        )
        assert cost == round(2.0 * 225), "should use lama's T4 per-second rate"
