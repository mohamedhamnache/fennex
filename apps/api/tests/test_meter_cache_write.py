import logging
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.cost_rate import CostRate
from app.models.usage_event import UsageEvent
from app.models.billing import OrgUsage
from app.core.billing import current_billing_period_start
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


async def test_anthropic_cache_write_tokens_priced_at_cache_write_rate():
    """Anthropic cache-creation tokens must be billed at the cache_write_token
    rate (~1.25x input) and recorded as raw token counts on the ledger."""
    await _seed(
        CostRate(provider="anthropic", unit="input_token", model="claude-opus-5", micro_dollars_per_unit=5.0),
        CostRate(provider="anthropic", unit="output_token", model="claude-opus-5", micro_dollars_per_unit=25.0),
        CostRate(provider="anthropic", unit="cache_read_token", model="claude-opus-5", micro_dollars_per_unit=0.5),
        CostRate(provider="anthropic", unit="cache_write_token", model="claude-opus-5", micro_dollars_per_unit=6.25),
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("anthropic", "claude-opus-5", input_tokens=100, output_tokens=10,
                         cache_read_tokens=20, cache_write_tokens=50)
        cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage)
        # 100*5.0 + 10*25.0 + 20*0.5 + 50*6.25 = 500 + 250 + 10 + 312.5 = 1072.5 -> round to 1072 or 1073
        assert cost == round(100 * 5.0 + 10 * 25.0 + 20 * 0.5 + 50 * 6.25)

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.cache_write_tokens == 50  # raw count, not adjusted

        ou = (await db.execute(select(OrgUsage).where(
            OrgUsage.org_id == org, OrgUsage.period_start == current_billing_period_start()
        ))).scalar_one()
        assert ou.cost_micros == cost


async def test_anthropic_batch_cache_write_uses_batch_rate():
    """The batch variant of a call must price cache-write tokens from
    batch_cache_write_token, not the interactive cache_write_token rate."""
    await _seed(
        CostRate(provider="anthropic", unit="batch_input_token", model="claude-opus-5", micro_dollars_per_unit=2.5),
        CostRate(provider="anthropic", unit="batch_output_token", model="claude-opus-5", micro_dollars_per_unit=12.5),
        CostRate(provider="anthropic", unit="batch_cache_read_token", model="claude-opus-5", micro_dollars_per_unit=0.25),
        CostRate(provider="anthropic", unit="batch_cache_write_token", model="claude-opus-5", micro_dollars_per_unit=3.125),
        # Interactive rates too, to prove the batch path doesn't fall back to them.
        CostRate(provider="anthropic", unit="input_token", model="claude-opus-5", micro_dollars_per_unit=5.0),
        CostRate(provider="anthropic", unit="output_token", model="claude-opus-5", micro_dollars_per_unit=25.0),
        CostRate(provider="anthropic", unit="cache_read_token", model="claude-opus-5", micro_dollars_per_unit=0.5),
        CostRate(provider="anthropic", unit="cache_write_token", model="claude-opus-5", micro_dollars_per_unit=6.25),
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("anthropic", "claude-opus-5", input_tokens=100, output_tokens=10,
                         cache_read_tokens=20, cache_write_tokens=50, batch=True)
        cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage)
        expected = round(100 * 2.5 + 10 * 12.5 + 20 * 0.25 + 50 * 3.125)
        assert cost == expected


async def test_missing_cache_write_rate_warns_and_prices_zero_without_corrupting_rest(caplog):
    """A missing cache_write_token rate must warn (naming the unit) and price
    the cache-write portion at 0 -- without corrupting the rest of the cost
    computed from input/output/cache-read."""
    await _seed(
        CostRate(provider="anthropic", unit="input_token", model="claude-opus-5", micro_dollars_per_unit=5.0),
        CostRate(provider="anthropic", unit="output_token", model="claude-opus-5", micro_dollars_per_unit=25.0),
        CostRate(provider="anthropic", unit="cache_read_token", model="claude-opus-5", micro_dollars_per_unit=0.5),
        # No cache_write_token rate seeded.
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("anthropic", "claude-opus-5", input_tokens=100, output_tokens=10,
                         cache_read_tokens=20, cache_write_tokens=50)
        with caplog.at_level(logging.WARNING):
            cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage)
        # cache-write priced to 0; the rest of the cost is unaffected.
        assert cost == round(100 * 5.0 + 10 * 25.0 + 20 * 0.5)
        assert any("cache_write_token" in r.message and "claude-opus-5" in r.message
                   for r in caplog.records)

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.cache_write_tokens == 50  # raw count still recorded


async def test_zero_cache_write_tokens_does_not_warn_or_query_rate(caplog):
    """When a call has no cache-write tokens (the common case), record_llm must
    not warn about a missing cache_write_token rate -- there's nothing to price."""
    await _seed(
        CostRate(provider="anthropic", unit="input_token", model="claude-opus-5", micro_dollars_per_unit=5.0),
        CostRate(provider="anthropic", unit="output_token", model="claude-opus-5", micro_dollars_per_unit=25.0),
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("anthropic", "claude-opus-5", input_tokens=100, output_tokens=10)
        with caplog.at_level(logging.WARNING):
            cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage)
        assert cost == round(100 * 5.0 + 10 * 25.0)
        assert not any("cache_write_token" in r.message for r in caplog.records)
