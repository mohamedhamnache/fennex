import uuid, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.services.agents.spec import AgentResult, Skill
from app.services.agents import standalone as S

_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
_Session = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def db():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        yield s
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


def _skill():
    return Skill(key="oasis.define_icp", agent_id="oasis", weight="light", tools=[],
                 build_prompt=lambda b, i, td: ("s", "u"), output="json")


async def test_org_tier_defaults_to_balanced(db):
    org = Organization(slug="o", name="O"); db.add(org); await db.flush()
    assert await S.org_tier(org.id, db) == "balanced"
    org.agent_tier = "max"; await db.flush()
    assert await S.org_tier(org.id, db) == "max"


async def test_run_standalone_builds_brief_and_runs_with_org_tier(db):
    org = Organization(slug="o2", name="O", agent_tier="economy"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com", persona="ecommerce"); db.add(proj); await db.flush()
    await db.commit()
    seen = {}
    async def fake_run(skill, brief, inputs, tier, db, keys=None, campaign=None):
        seen["tier"] = tier; seen["persona"] = brief.persona; seen["goal"] = brief.goal
        return AgentResult(ok=True, summary="did it", content={"x": 1})
    with patch("app.services.agents.standalone.AgentRunner.run", new=AsyncMock(side_effect=fake_run)):
        r = await S.run_standalone(_skill(), proj.id, org.id, goal="Define clients", db=db, inputs={"k": "v"})
    assert r.ok and r.content == {"x": 1}
    assert seen == {"tier": "economy", "persona": "ecommerce", "goal": "Define clients"}
