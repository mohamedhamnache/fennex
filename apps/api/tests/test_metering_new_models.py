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


async def test_nano_banana_bills_per_image_at_the_seeded_rate():
    """The default path for every Mirage edit. Seeded per IMAGE because it is an
    official Replicate model billed per output image, not per GPU-second."""
    org = uuid.uuid4()
    async with Session() as db:
        db.add(CostRate(provider="replicate", unit="image",
                        model="google/nano-banana", micro_dollars_per_unit=39_000))
        await db.commit()
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model="google/nano-banana",
            feature="instruction_edit", predict_seconds=5.38, image_count=1,
        )
    assert cost == 39_000
    # and it is billed, not merely recorded
    async with Session() as db:
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_credits_used >= 10
        assert ou.ai_cost_micros == 39_000


async def test_product_shadow_bills_per_second_at_the_a100_rate():
    org = uuid.uuid4()
    async with Session() as db:
        db.add(CostRate(provider="replicate", unit="second",
                        model="bria/product-shadow", micro_dollars_per_unit=1_400))
        await db.commit()
        cost = await meter.record_replicate(
            db, org_id=org, project_id=None, model="bria/product-shadow",
            feature="generate_shadow", predict_seconds=4.25,
        )
    assert cost == round(4.25 * 1_400)


async def test_an_unpriced_per_image_model_warns_loudly(caplog):
    """Replicate reports image_output_count only for models it bills PER IMAGE,
    so reaching the duration fallback means an official image model is priced on
    the wrong axis and is undercharging. That leaked silently once already:
    nano-banana billed 11 credits by duration against 38 per image, because the
    rate migration had not been applied to the running database.
    """
    import logging

    org = uuid.uuid4()
    async with Session() as db:
        with caplog.at_level(logging.WARNING):
            cost = await meter.record_replicate(
                db, org_id=org, project_id=None, model="google/nano-banana",
                predict_seconds=8.0, image_count=1,
            )

    # still bills something rather than failing the user's edit
    assert cost == round(8.0 * 1_400)
    warned = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert any("google/nano-banana" in m and "image" in m for m in warned), warned


async def test_a_priced_per_image_model_does_not_warn(caplog):
    import logging

    org = uuid.uuid4()
    async with Session() as db:
        db.add(CostRate(provider="replicate", unit="image",
                        model="google/nano-banana", micro_dollars_per_unit=39_000))
        await db.commit()
        with caplog.at_level(logging.WARNING):
            cost = await meter.record_replicate(
                db, org_id=org, project_id=None, model="google/nano-banana",
                predict_seconds=8.0, image_count=1,
            )

    assert cost == 39_000
    assert not [r for r in caplog.records
                if r.levelno >= logging.WARNING and "cost rate" in r.getMessage()]


async def test_gemini_reports_its_real_token_usage():
    """Every Google call metered as ZERO tokens and therefore billed nothing --
    a paid supplier call charged to no one. The response carries usageMetadata;
    the old call shape simply never read it."""
    from unittest.mock import AsyncMock, patch

    from app.services import llm_service

    payload = {
        "candidates": [{"content": {"parts": [{"text": "hello"}]}}],
        "usageMetadata": {"promptTokenCount": 1200, "candidatesTokenCount": 340},
    }

    class _Resp:
        def raise_for_status(self): return None
        def json(self): return payload

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): return _Resp()

    with patch("app.services.llm_service.httpx.AsyncClient", lambda **k: _Client()):
        text, usage = await llm_service._google_usage("gemini-1.5-flash", "k", "sys", "usr")

    assert text == "hello"
    assert usage.provider == "google"
    assert usage.input_tokens == 1200
    assert usage.output_tokens == 340


async def test_gemini_falls_back_to_total_minus_prompt():
    """candidatesTokenCount is absent on some responses."""
    from unittest.mock import patch

    from app.services import llm_service

    payload = {
        "candidates": [{"content": {"parts": [{"text": "x"}]}}],
        "usageMetadata": {"promptTokenCount": 900, "totalTokenCount": 1150},
    }

    class _Resp:
        def raise_for_status(self): return None
        def json(self): return payload

    class _Client:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): return False
        async def post(self, *a, **k): return _Resp()

    with patch("app.services.llm_service.httpx.AsyncClient", lambda **k: _Client()):
        _, usage = await llm_service._google_usage("gemini-1.5-pro", "k", "s", "u")

    assert usage.input_tokens == 900
    assert usage.output_tokens == 250
