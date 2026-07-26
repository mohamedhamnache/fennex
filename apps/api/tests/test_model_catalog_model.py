import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.model_catalog import ModelCatalog

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_row_round_trips_with_supports_json():
    async with Session() as db:
        db.add(ModelCatalog(band="cheap", provider="openai", model="gpt-4o-mini",
                            priority=1, supports={"json_output": True, "tools": True}))
        await db.commit()
    async with Session() as db:
        row = (await db.execute(select(ModelCatalog))).scalar_one()
        assert (row.band, row.provider, row.model, row.priority) == ("cheap", "openai", "gpt-4o-mini", 1)
        assert row.supports["json_output"] is True
        assert row.is_active is True


async def test_same_model_can_serve_two_bands():
    """The PK is (band, provider, model), so one model may appear in two bands."""
    async with Session() as db:
        db.add_all([
            ModelCatalog(band="standard", provider="openai", model="gpt-4o", priority=1),
            ModelCatalog(band="premium", provider="openai", model="gpt-4o", priority=9),
        ])
        await db.commit()
        rows = (await db.execute(select(ModelCatalog))).scalars().all()
        assert len(rows) == 2
