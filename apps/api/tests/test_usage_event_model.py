import uuid
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.usage_event import UsageEvent
from app.models.billing import OrgUsage

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_usage_event_and_org_usage_columns():
    async with Session() as db:
        ev = UsageEvent(org_id=uuid.uuid4(), kind="llm", provider="openai",
                        model="gpt-4o-mini", input_tokens=1000, output_tokens=200,
                        cost_micros=270)
        db.add(ev)
        await db.commit()
        await db.refresh(ev)
        assert ev.id is not None
        assert ev.cost_micros == 270
    # org_usage raw columns exist and default to 0
    from datetime import date
    async with Session() as db:
        ou = OrgUsage(org_id=uuid.uuid4(), period_start=date(2026, 7, 1))
        db.add(ou)
        await db.commit()
        await db.refresh(ou)
        assert ou.ai_input_tokens == 0 and ou.cost_micros == 0 and ou.seo_serp == 0
