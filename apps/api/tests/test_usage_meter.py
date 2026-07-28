import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.core.billing import current_billing_period_start
from app.models.cost_rate import CostRate
from app.models.usage_event import UsageEvent
from app.models.billing import OrgUsage
from app.services.llm_service import LLMUsage
from app.services.metering import meter

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add_all([
            CostRate(provider="openai", unit="input_token", model="gpt-4o-mini", micro_dollars_per_unit=0.15),
            CostRate(provider="openai", unit="output_token", model="gpt-4o-mini", micro_dollars_per_unit=0.60),
            CostRate(provider="dataforseo", unit="serp", model="", micro_dollars_per_unit=1500),
        ])
        await db.commit()
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_record_llm_prices_and_rolls_up():
    org = uuid.uuid4()
    async with Session() as db:
        usage = LLMUsage("openai", "gpt-4o-mini", input_tokens=1000, output_tokens=200)
        cost = await meter.record_llm(db, org_id=org, project_id=None, usage=usage, feature="article")
        # 1000*0.15 + 200*0.60 = 150 + 120 = 270 micro-dollars
        assert cost == 270
        ev = (await db.execute(select(UsageEvent).where(UsageEvent.org_id == org))).scalar_one()
        assert ev.kind == "llm" and ev.cost_micros == 270 and ev.input_tokens == 1000
        ou = (await db.execute(select(OrgUsage).where(
            OrgUsage.org_id == org, OrgUsage.period_start == current_billing_period_start()
        ))).scalar_one()
        assert ou.ai_input_tokens == 1000 and ou.ai_output_tokens == 200
        assert ou.ai_requests == 1 and ou.cost_micros == 270
        # LLM credits are cost-derived and UNFLOORED -- the 10-credit floor
        # applies only to Replicate ("edit") operations. 270 micros is well
        # under one credit's floor value, proving it does not leak here.
        assert ou.ai_credits_used == 1


async def test_record_seo_prices_and_rolls_up():
    org = uuid.uuid4()
    async with Session() as db:
        cost = await meter.record_seo(db, org_id=org, project_id=None, unit="serp", count=3, feature="discovery")
        assert cost == 4500  # 3 * 1500
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.seo_serp == 3 and ou.cost_micros == 4500


async def test_record_llm_accumulates_across_calls():
    org = uuid.uuid4()
    async with Session() as db:
        u = LLMUsage("openai", "gpt-4o-mini", input_tokens=100, output_tokens=0)
        await meter.record_llm(db, org_id=org, project_id=None, usage=u)
        await meter.record_llm(db, org_id=org, project_id=None, usage=u)
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_requests == 2 and ou.ai_input_tokens == 200
