import datetime as dt
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.credits import credits_from_micros
from app.core.database import Base
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


async def test_credit_split_columns_default_to_zero():
    org = uuid.uuid4()
    async with Session() as db:
        db.add(OrgUsage(org_id=org, period_start=dt.date(2026, 7, 1)))
        await db.commit()
        row = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert row.ai_cost_micros == 0
        assert row.seo_credits_used == 0
        assert row.ai_credits_used == 0


async def test_ai_credits_derive_from_ai_cost_not_total_cost():
    """SEO spend must not consume the AI bucket."""
    org = uuid.uuid4()
    async with Session() as db:
        db.add(OrgUsage(
            org_id=org, period_start=dt.date(2026, 7, 1),
            cost_micros=105_000,      # total: AI + SEO
            ai_cost_micros=52_500,    # AI only
            seo_credits_used=40,
        ))
        await db.commit()
        row = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert credits_from_micros(row.ai_cost_micros) == 50   # 52_500 / 1_050
        assert credits_from_micros(row.cost_micros) == 100     # the wrong bucket: double
        assert row.seo_credits_used == 40
