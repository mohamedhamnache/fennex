import logging
import uuid
from datetime import datetime, timezone

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


async def test_openai_cached_input_tokens_not_double_charged():
    """OpenAI's prompt_tokens already includes cached tokens, so the cached
    subset must be billed once (at the cache rate), not at both the full
    input rate and the cache rate."""
    await _seed(
        CostRate(provider="openai", unit="input_token", model="gpt-4o-mini", micro_dollars_per_unit=0.15),
        CostRate(provider="openai", unit="output_token", model="gpt-4o-mini", micro_dollars_per_unit=0.60),
        CostRate(provider="openai", unit="cache_read_token", model="gpt-4o-mini", micro_dollars_per_unit=0.075),
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("openai", "gpt-4o-mini", input_tokens=1000, output_tokens=0, cache_read_tokens=400)
        cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage)
        # non-cached 600 * 0.15 = 90 + cached 400 * 0.075 = 30 -> 120
        assert cost == 120

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.input_tokens == 1000  # raw prompt_tokens, not reduced

        ou = (await db.execute(select(OrgUsage).where(
            OrgUsage.org_id == org, OrgUsage.period_start == current_billing_period_start()
        ))).scalar_one()
        assert ou.ai_input_tokens == 1000  # raw, not reduced


async def test_anthropic_cache_read_is_additive_not_subtracted():
    """Anthropic's input_tokens already excludes cache-read tokens, so the
    provider-aware billing must NOT subtract for anthropic -- it stays a
    straightforward additive sum."""
    await _seed(
        CostRate(provider="anthropic", unit="input_token", model="claude-opus-4-8", micro_dollars_per_unit=5.0),
        CostRate(provider="anthropic", unit="output_token", model="claude-opus-4-8", micro_dollars_per_unit=25.0),
        CostRate(provider="anthropic", unit="cache_read_token", model="claude-opus-4-8", micro_dollars_per_unit=0.5),
    )
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("anthropic", "claude-opus-4-8", input_tokens=100, output_tokens=10, cache_read_tokens=20)
        cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage)
        # 100*5.0 + 10*25.0 + 20*0.5 = 500 + 250 + 10 = 760
        assert cost == 760


async def test_rate_resolves_to_newest_effective_from_row():
    """cost_rates are versioned by effective_from (part of the PK) so a price
    change inserts a new row rather than rewriting the old one. rate() must
    pick the newest row, not the first/oldest, for the same
    (provider, unit, model)."""
    await _seed(
        CostRate(provider="replicate", unit="run", model="black-forest-labs/flux-fill-pro",
                  micro_dollars_per_unit=5_000,
                  effective_from=datetime(2026, 1, 1, tzinfo=timezone.utc)),
        CostRate(provider="replicate", unit="run", model="black-forest-labs/flux-fill-pro",
                  micro_dollars_per_unit=50_000,
                  effective_from=datetime(2026, 7, 28, tzinfo=timezone.utc)),
    )
    async with Session() as db:
        resolved = await meter.rate(db, "replicate", "run", "black-forest-labs/flux-fill-pro")
        assert resolved == 50_000


async def test_missing_cost_rate_logs_warning_and_prices_zero(caplog):
    """Anthropic models with no seeded cost_rate row must not silently price
    to $0 without a trace -- a warning naming the model should be logged."""
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("anthropic", "claude-opus-4-8", input_tokens=100, output_tokens=10, cache_read_tokens=0)
        with caplog.at_level(logging.WARNING):
            cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage)
        assert cost == 0
        assert any("claude-opus-4-8" in r.message for r in caplog.records)
