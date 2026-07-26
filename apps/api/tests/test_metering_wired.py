import uuid
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.cost_rate import CostRate
from app.models.billing import OrgUsage
from app.services import llm_service

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


class _FakeUsage:
    prompt_tokens = 500
    completion_tokens = 100
    prompt_tokens_details = None
class _Msg:
    content = "ok"
class _Choice:
    message = _Msg()
class _Resp:
    choices = [_Choice()]
    usage = _FakeUsage()
class _FakeOpenAI:
    def __init__(self, api_key): self.chat = self; self.completions = self
    async def create(self, **kw): return _Resp()


@pytest.fixture(autouse=True)
async def setup_db(monkeypatch):
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        db.add_all([
            CostRate(provider="openai", unit="input_token", model="gpt-4o-mini", micro_dollars_per_unit=0.15),
            CostRate(provider="openai", unit="output_token", model="gpt-4o-mini", micro_dollars_per_unit=0.60),
        ])
        await db.commit()
    monkeypatch.setattr(llm_service, "AsyncOpenAI", _FakeOpenAI)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def test_call_llm_with_meter_records_usage():
    org = uuid.uuid4()
    async with Session() as db:
        out = await llm_service.call_llm(
            "openai", "gpt-4o-mini", "k", "sys", "user",
            meter={"db": db, "org_id": org, "project_id": None, "feature": "test"},
        )
        assert out == "ok"
        ou = (await db.execute(select(OrgUsage).where(OrgUsage.org_id == org))).scalar_one()
        assert ou.ai_requests == 1 and ou.ai_input_tokens == 500
        # cost = 500*0.15 + 100*0.60 = 75 + 60 = 135
        assert ou.cost_micros == 135


async def test_call_llm_without_meter_records_nothing():
    org = uuid.uuid4()
    async with Session() as db:
        out = await llm_service.call_llm("openai", "gpt-4o-mini", "k", "sys", "user")
        assert out == "ok"
        rows = (await db.execute(select(OrgUsage))).scalars().all()
        assert rows == []
