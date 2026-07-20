import uuid
from app.services.agents.spec import AgentResult, Skill
from app.services.agents.brief import Brief


def _brief():
    return Brief(goal="g", persona="creator", project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                 locale="en", project_profile="", brand={}, existing_content=[], artifacts=[])


def test_agentresult_defaults():
    r = AgentResult(ok=True)
    assert r.summary == "" and r.artifact_ids == [] and r.structured == {} and r.error is None


def test_add_artifact_appends_compact_handoff():
    b = _brief()
    b.add_artifact(AgentResult(ok=True, summary="Article: X targeting kw", artifact_type="article",
                               artifact_ids=["a1"]), agent_id="dune", skill_key="dune.write_article")
    assert len(b.artifacts) == 1
    a = b.artifacts[0]
    assert a["agent"] == "dune" and a["skill"] == "dune.write_article"
    assert a["summary"] == "Article: X targeting kw" and a["artifact_ids"] == ["a1"]


def test_skill_is_constructible():
    s = Skill(key="x.y", agent_id="zerda", weight="light", tools=[],
              build_prompt=lambda brief, inputs, td: ("sys", "usr"), output="json")
    assert s.key == "x.y" and s.parse is None and s.persist is None


import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.article import Article, ArticleStatus
from app.services.agents.brief import build_brief

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


async def test_build_brief_collects_titles_and_goal(db):
    org = Organization(slug="o", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com", locale="fr"); db.add(proj); await db.flush()
    db.add(Article(org_id=org.id, project_id=proj.id, title="Old Post", status=ArticleStatus.ready))
    await db.commit()
    brief = await build_brief(proj.id, org.id, goal="Launch serum", persona="ecommerce", db=db)
    assert brief.goal == "Launch serum" and brief.persona == "ecommerce"
    assert brief.locale == "fr"
    assert "Old Post" in brief.existing_content
    assert isinstance(brief.brand, dict) and brief.artifacts == []
