import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.cost_rate import CostRate
from app.models.usage_event import UsageEvent
from app.services.llm_service import LLMUsage
from app.services.metering import meter

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def _seed(*rows):
    async with Session() as db:
        db.add_all(rows)
        await db.commit()


async def test_batch_usage_is_priced_from_the_batch_units():
    """The 50% batch discount is a rate, not a multiplier hardcoded in the meter,
    so a future discount change stays a data change."""
    await _seed(
        CostRate(provider="openai", unit="input_token", model="gpt-4o", micro_dollars_per_unit=2.5),
        CostRate(provider="openai", unit="output_token", model="gpt-4o", micro_dollars_per_unit=10.0),
        CostRate(provider="openai", unit="cache_read_token", model="gpt-4o", micro_dollars_per_unit=1.25),
        CostRate(provider="openai", unit="batch_input_token", model="gpt-4o", micro_dollars_per_unit=1.25),
        CostRate(provider="openai", unit="batch_output_token", model="gpt-4o", micro_dollars_per_unit=5.0),
        CostRate(provider="openai", unit="batch_cache_read_token", model="gpt-4o", micro_dollars_per_unit=0.625),
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("openai", "gpt-4o", input_tokens=1000, output_tokens=100,
                         cache_read_tokens=0, batch=True)
        cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage)
        # 1000 * 1.25 + 100 * 5.0 = 1250 + 500 = 1750 (half of the interactive 3500)
        assert cost == 1750


async def test_interactive_usage_still_uses_the_plain_units():
    await _seed(
        CostRate(provider="openai", unit="input_token", model="gpt-4o", micro_dollars_per_unit=2.5),
        CostRate(provider="openai", unit="output_token", model="gpt-4o", micro_dollars_per_unit=10.0),
        CostRate(provider="openai", unit="batch_input_token", model="gpt-4o", micro_dollars_per_unit=1.25),
        CostRate(provider="openai", unit="batch_output_token", model="gpt-4o", micro_dollars_per_unit=5.0),
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("openai", "gpt-4o", input_tokens=1000, output_tokens=100)
        assert await meter.record_llm(db, org_id=org, project_id=None, usage=usage) == 3500


async def test_batch_openai_cached_tokens_are_still_not_double_charged():
    await _seed(
        CostRate(provider="openai", unit="batch_input_token", model="gpt-4o-mini", micro_dollars_per_unit=0.075),
        CostRate(provider="openai", unit="batch_output_token", model="gpt-4o-mini", micro_dollars_per_unit=0.30),
        CostRate(provider="openai", unit="batch_cache_read_token", model="gpt-4o-mini", micro_dollars_per_unit=0.0375),
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("openai", "gpt-4o-mini", input_tokens=1000, output_tokens=0,
                         cache_read_tokens=400, batch=True)
        # non-cached 600 * 0.075 = 45 + cached 400 * 0.0375 = 15 -> 60
        assert await meter.record_llm(db, org_id=org, project_id=None, usage=usage) == 60
        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.input_tokens == 1000  # raw tokens, never reduced


async def test_missing_batch_rate_warns_and_prices_zero(caplog):
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("openai", "unpriced-model", input_tokens=100, output_tokens=1, batch=True)
        cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage)
        assert cost == 0
        assert any("unpriced-model" in r.message for r in caplog.records)
