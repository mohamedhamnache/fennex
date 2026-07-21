import uuid, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.social import SocialPost
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
    proj = Project(org_id=org.id, name="Acme", domain="acme.com", persona="freelancer"); db.add(proj)
    await db.commit(); return org, proj


async def test_testimonial_empty_guard(db):
    from app.services import nomad_service
    org, proj = await _org_proj(db)
    out = await nomad_service.generate_testimonial_content(proj.id, org.id, "  ", "", "", db)
    assert out == {"ok": False, "error": "empty"}


async def test_testimonial_maps_pieces(db):
    from app.services import nomad_service
    org, proj = await _org_proj(db)
    content = {"pieces": [
        {"format": "linkedin_post", "content": "A story."},
        {"format": "bogus", "content": "dropped"},
        {"format": "quote_card", "content": "Great work."},
    ]}
    with patch("app.services.nomad_service.run_standalone",
               new=AsyncMock(return_value=AgentResult(ok=True, content=content))):
        out = await nomad_service.generate_testimonial_content(proj.id, org.id, "They loved it", "Bob", "SEO", db)
    assert out["ok"] is True and [p["format"] for p in out["pieces"]] == ["linkedin_post", "quote_card"]


async def test_outreach_maps_and_saves_drafts(db):
    from app.services import nomad_service
    org, proj = await _org_proj(db)
    content = {
        "posts": [{"day": "Mon", "type": "tip", "content": "Post one", "hashtags": ["#seo", "", "#x"]},
                  {"type": "story", "content": "Post two"}],
        "messages": [{"scenario": "cold", "content": "Hi there"}],
        "tips": ["be consistent", ""],
    }
    with patch("app.services.nomad_service.run_standalone",
               new=AsyncMock(return_value=AgentResult(ok=True, content=content))):
        out = await nomad_service.generate_outreach_plan(proj.id, org.id, "Win clients", db, "founders")
    assert out["ok"] is True and out["drafts_saved"] == 2 and len(out["posts"]) == 2
    assert out["posts"][0]["hashtags"] == ["#seo", "#x"]
    saved = (await db.execute(select(SocialPost).where(SocialPost.project_id == proj.id))).scalars().all()
    assert len(saved) == 2 and all(p.platform.value == "linkedin" for p in saved)
