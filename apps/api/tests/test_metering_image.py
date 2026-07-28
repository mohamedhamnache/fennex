import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.credits import credits_from_micros
from app.core.database import Base
from app.models.billing import OrgUsage
from app.models.usage_event import UsageEvent
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


async def test_record_image_writes_event_and_consumes_ai_credits():
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_image(
            db, org_id=org, project_id=None, model="gpt-image-1",
            cost_usd=0.06, feature="article_cover",
        )
        assert cost == 60_000

        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "image"
        assert ev.provider == "openai"
        assert ev.model == "gpt-image-1"
        assert ev.feature == "article_cover"
        assert ev.cost_micros == 60_000

        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.cost_micros == 60_000       # counts toward the true total
        assert ou.ai_cost_micros == 60_000    # and toward the AI bucket
        assert credits_from_micros(ou.ai_cost_micros) == 58
        # Image generation is NOT subject to the Replicate-only floor -- the
        # counter matches the unfloored cost-derived credits.
        assert ou.ai_credits_used == 58
