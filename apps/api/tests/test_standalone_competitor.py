import uuid, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
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


async def _org_proj(db):
    org = Organization(slug=f"o{uuid.uuid4().hex[:6]}", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="Acme", domain="acme.com", persona="company"); db.add(proj)
    await db.commit(); return org, proj


async def test_analyze_renders_skill_insights(db):
    from app.services import competitor_service as C
    org, proj = await _org_proj(db)
    page = {"status_code": 200, "url": "https://rival.com", "title": "T", "meta_description": "M", "h2": ["A", "B"]}
    card = {"title": "T", "meta_description": "M", "word_count": 900, "h1_count": 1, "h2_count": 2,
            "schema_types": [], "internal_links": 3, "score": 61}
    skill_out = AgentResult(ok=True, content={"scorecard": {"score": 61},
                            "gaps": ["No FAQ schema", "Thin intro"], "insights": "They rank on brand terms only."})
    with patch.object(C, "_crawl", new=AsyncMock(return_value=page)), \
         patch.object(C, "_scorecard", return_value=card), \
         patch("app.services.competitor_service.run_standalone", new=AsyncMock(return_value=skill_out)):
        out = await C.analyze(proj.id, org.id, "https://rival.com", db)
    assert out["ok"] is True and out["scorecard"]["score"] == 61
    assert "They rank on brand terms only." in out["insights"]
    assert "No FAQ schema" in out["insights"]  # gaps folded into the insights string


async def test_analyze_insights_empty_on_skill_failure(db):
    from app.services import competitor_service as C
    org, proj = await _org_proj(db)
    page = {"status_code": 200, "url": "https://rival.com", "title": "T", "meta_description": "M", "h2": []}
    card = {"title": "T", "meta_description": "M", "word_count": 500, "h1_count": 1, "h2_count": 0,
            "schema_types": [], "internal_links": 1, "score": 40}
    with patch.object(C, "_crawl", new=AsyncMock(return_value=page)), \
         patch.object(C, "_scorecard", return_value=card), \
         patch("app.services.competitor_service.run_standalone",
               new=AsyncMock(return_value=AgentResult(ok=False, error="no key"))):
        out = await C.analyze(proj.id, org.id, "https://rival.com", db)
    assert out["ok"] is True and out["insights"] == ""
