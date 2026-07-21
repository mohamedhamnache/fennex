import uuid, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.article import Article, ArticleStatus, ArticleRevision
from app.services.agents.brief import Brief
from app.services.agents import tools as T
from app.services.agents.spec import AgentResult

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


async def _brief_art(db):
    org = Organization(slug=f"o{uuid.uuid4().hex[:6]}", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com"); db.add(proj); await db.flush()
    art = Article(org_id=org.id, project_id=proj.id, title="Vegan protein guide",
                  target_keyword="vegan protein", status=ArticleStatus.generating)
    db.add(art); await db.commit()
    brief = Brief(goal="g", persona="creator", project_id=proj.id, org_id=org.id, locale="en",
                  project_profile="A vegan blog", brand={}, existing_content=[], artifacts=[])
    return brief, art


async def test_article_context_returns_prompts(db):
    brief, art = await _brief_art(db)
    data = await T.article_context(brief, db, {"article_id": str(art.id)})
    assert data["title"] == "Vegan protein guide" and data["keyword"] == "vegan protein"
    assert isinstance(data["system"], str) and "vegan protein" in data["user"].lower()


async def test_article_context_missing_article(db):
    brief, art = await _brief_art(db)
    assert await T.article_context(brief, db, {"article_id": str(uuid.uuid4())}) == {}


async def test_seo_grounding_tool_degrades(db):
    brief, art = await _brief_art(db)
    with patch("app.services.writing_service._seo_grounding", new=AsyncMock(return_value="GSC: vegan protein (pos 8)")):
        data = await T.seo_grounding(brief, db, {"article_id": str(art.id)})
    assert data["grounding"] == "GSC: vegan protein (pos 8)"


def test_generate_article_prompt_uses_tool_context_and_grounding():
    from app.services.agents.skills import dune
    brief = Brief(goal="g", persona="creator", project_id=uuid.uuid4(), org_id=uuid.uuid4(), locale="en",
                  project_profile="", brand={}, existing_content=[], artifacts=[])
    td = {"article_context": {"ok": True, "data": {"system": "SYS", "user": "USER-PROMPT", "title": "T", "keyword": "k"}},
          "seo_grounding": {"ok": True, "data": {"grounding": "GSC ROWS"}}}
    system, user = dune.GENERATE_ARTICLE.build_prompt(brief, {"feedback": "add specifics"}, td)
    assert system == "SYS" and "USER-PROMPT" in user and "GSC ROWS" in user and "add specifics" in user
    assert dune.GENERATE_ARTICLE.max_tokens is not None and dune.GENERATE_ARTICLE.persist is not None


async def test_generate_article_persist_updates_in_place(db):
    from app.services.agents.skills import dune
    brief, art = await _brief_art(db)
    brief.runtime = {"provider": "anthropic", "model": "claude-opus-4-8", "api_key": "x",
                     "tier": "balanced", "inputs": {"article_id": str(art.id)}}
    raw = "META_TITLE: T\nMETA_DESCRIPTION: D\n---\n# T\n\nvegan protein body with enough words."
    with patch("app.services.agents.skills.dune.ensure_seo_quality",
               new=AsyncMock(return_value=("# T\n\nfinal body", 88.0))):
        res = await dune.GENERATE_ARTICLE.persist(raw, None, brief, db)
    assert res.ok and res.artifact_type == "article" and res.artifact_ids == [str(art.id)]
    await db.refresh(art)
    assert art.status == ArticleStatus.ready and art.seo_score == 88.0 and art.body_markdown == "# T\n\nfinal body"
    revs = (await db.execute(select(ArticleRevision).where(ArticleRevision.article_id == art.id))).scalars().all()
    assert len(revs) == 1 and revs[0].note == "Initial generation"
