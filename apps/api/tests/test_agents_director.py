import uuid, json, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy import select
from app.services.agents.brief import Brief
from app.services.agents import director


def _brief(persona="creator"):
    return Brief(goal="g", persona=persona, project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                 locale="en", project_profile="", brand={}, existing_content=[], artifacts=[])


def test_persona_flow_has_create_and_distribute():
    for persona in ["creator", "ecommerce", "freelancer", "company"]:
        steps = [{"skill": k} for k in director._persona_flow(persona)]
        assert director._has_create_and_distribute(steps)


async def test_plan_falls_back_when_llm_plan_is_thin():
    with patch("app.services.agents.director.call_llm", new=AsyncMock(return_value='{"steps":[{"skill":"zerda.pick_angle"}]}')):
        steps = await director.plan(_brief("creator"), tier="balanced", keys={"anthropic": "x"}, db=None)
    # thin plan (no create+distribute) -> persona fallback
    assert any(s["skill"] == "dune.write_article" for s in steps)
    assert director._has_create_and_distribute(steps)


async def test_plan_keeps_valid_llm_plan():
    good = {"steps": [{"skill": "zerda.pick_angle", "why": "a"}, {"skill": "dune.write_article", "why": "b"},
                      {"skill": "sirocco.multi_network_social", "why": "c"}]}
    with patch("app.services.agents.director.call_llm", new=AsyncMock(return_value=json.dumps(good))):
        steps = await director.plan(_brief("creator"), tier="balanced", keys={"anthropic": "x"}, db=None)
    assert [s["skill"] for s in steps] == ["zerda.pick_angle", "dune.write_article", "sirocco.multi_network_social"]


from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.campaign import Campaign, CampaignStep
from app.services.agents.spec import AgentResult
from app.services.agents import director as D

_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
_Session = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture
async def db():
    async with _engine.begin() as c: await c.run_sync(Base.metadata.create_all)
    async with _Session() as s: yield s
    async with _engine.begin() as c: await c.run_sync(Base.metadata.drop_all)


async def test_run_campaign_executes_plan_and_records_steps(db):
    org = Organization(slug="o", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com"); db.add(proj); await db.flush()
    camp = Campaign(org_id=org.id, project_id=proj.id, goal="Launch", persona="creator", status="planned")
    db.add(camp); await db.commit()

    async def fake_run(skill, brief, inputs, tier, db, keys=None, campaign=None):
        return AgentResult(ok=True, summary=f"did {skill.key}",
                           structured={"topic": "T", "keyword": "k"} if skill.key.endswith("pick_angle") else {})
    with patch.object(D, "plan", new=AsyncMock(return_value=[
             {"skill": "zerda.pick_angle", "why": "", "inputs": {}},
             {"skill": "dune.write_article", "why": "", "inputs": {}},
             {"skill": "sirocco.multi_network_social", "why": "", "inputs": {}}])), \
         patch("app.services.agents.director.AgentRunner.run", new=AsyncMock(side_effect=fake_run)), \
         patch("app.services.agents.director.review", new=AsyncMock(return_value={"passed": True, "score": 90, "feedback": ""})), \
         patch("app.services.agents.director.get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "x"})):
        await D.run_campaign(camp, db)

    steps = (await db.execute(select(CampaignStep).where(CampaignStep.campaign_id == camp.id).order_by(CampaignStep.order))).scalars().all()
    assert [s.action for s in steps] == ["zerda.pick_angle", "dune.write_article", "sirocco.multi_network_social"]
    assert all(s.status == "completed" for s in steps)
    await db.refresh(camp); assert camp.status == "completed"


async def test_run_campaign_retries_weak_step_then_continues(db):
    org = Organization(slug="o2", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com"); db.add(proj); await db.flush()
    camp = Campaign(org_id=org.id, project_id=proj.id, goal="G", persona="creator", status="planned"); db.add(camp); await db.commit()
    reviews = [{"passed": False, "score": 40, "feedback": "too generic"}, {"passed": True, "score": 85, "feedback": ""}]
    run = AsyncMock(return_value=AgentResult(ok=True, summary="x", structured={}))
    with patch.object(D, "plan", new=AsyncMock(return_value=[{"skill": "dune.write_article", "why": "", "inputs": {}},
             {"skill": "sirocco.multi_network_social", "why": "", "inputs": {}}])), \
         patch("app.services.agents.director.AgentRunner.run", new=run), \
         patch("app.services.agents.director.review", new=AsyncMock(side_effect=reviews + [{"passed": True, "score": 80, "feedback": ""}])), \
         patch("app.services.agents.director.get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "x"})):
        await D.run_campaign(camp, db)
    # write_article ran twice (initial + 1 retry), social ran once => 3 runner calls
    assert run.call_count == 3
