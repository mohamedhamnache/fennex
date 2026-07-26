import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.cost_rate import CostRate
from app.models.model_catalog import ModelCatalog
from app.services.providers import catalog

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    catalog.invalidate_snapshot()
    yield
    catalog.invalidate_snapshot()
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


def test_empty_snapshot_falls_back_to_hardcoded_seed():
    """A fresh DB or a failed refresh must still route to the right models."""
    assert catalog.resolve_band("cheap", ["openai"]) == ("openai", "gpt-4o-mini")
    assert catalog.resolve_band("standard", ["openai"]) == ("openai", "gpt-4o")


def test_primary_wins_when_both_providers_available():
    assert catalog.resolve_band("standard", ["anthropic", "openai"]) == ("openai", "gpt-4o")


def test_falls_back_to_next_priority_when_primary_provider_missing():
    assert catalog.resolve_band("standard", ["anthropic"]) == ("anthropic", "claude-sonnet-5")


def test_unmet_capability_skips_the_row():
    assert catalog.resolve_band("premium", ["anthropic"]) == ("anthropic", "claude-opus-5")
    # no seeded model declares audio support, so no band has a usable row and
    # resolution runs out of candidates rather than returning an incapable model
    with pytest.raises(ValueError):
        catalog.resolve_band("premium", ["anthropic", "openai"], needs={"audio": True})


def test_band_with_no_usable_row_walks_down_not_raises():
    """A missing premium key must degrade to standard, never fail the request."""
    assert catalog.resolve_band("premium", ["openai"]) == ("openai", "gpt-4o")


def test_no_providers_raises():
    with pytest.raises(ValueError):
        catalog.resolve_band("cheap", [])


async def test_snapshot_overrides_the_seed():
    async with Session() as db:
        db.add(ModelCatalog(band="cheap", provider="openai", model="gpt-4o-mini-2",
                            priority=1, supports={}))
        await db.commit()
        await catalog.refresh_snapshot(db)
    assert catalog.resolve_band("cheap", ["openai"]) == ("openai", "gpt-4o-mini-2")


async def test_inactive_rows_are_ignored():
    async with Session() as db:
        db.add_all([
            ModelCatalog(band="cheap", provider="openai", model="broken", priority=1,
                         supports={}, is_active=False),
            ModelCatalog(band="cheap", provider="openai", model="good", priority=2, supports={}),
        ])
        await db.commit()
        await catalog.refresh_snapshot(db)
    assert catalog.resolve_band("cheap", ["openai"]) == ("openai", "good")


async def test_priority_tie_breaks_on_cost():
    """Equal priority -> the cheaper model by cost_rates wins (spec 3.4.3 #8)."""
    async with Session() as db:
        db.add_all([
            ModelCatalog(band="cheap", provider="openai", model="pricey", priority=1, supports={}),
            ModelCatalog(band="cheap", provider="anthropic", model="thrifty", priority=1, supports={}),
            CostRate(provider="openai", unit="input_token", model="pricey", micro_dollars_per_unit=5.0),
            CostRate(provider="openai", unit="output_token", model="pricey", micro_dollars_per_unit=15.0),
            CostRate(provider="anthropic", unit="input_token", model="thrifty", micro_dollars_per_unit=0.5),
            CostRate(provider="anthropic", unit="output_token", model="thrifty", micro_dollars_per_unit=1.5),
        ])
        await db.commit()
        await catalog.refresh_snapshot(db)
    assert catalog.resolve_band("cheap", ["openai", "anthropic"]) == ("anthropic", "thrifty")
