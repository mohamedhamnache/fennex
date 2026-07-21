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
    proj = Project(org_id=org.id, name="Acme", domain="acme.com", persona="creator"); db.add(proj)
    await db.commit(); return org, proj


async def test_studio_maps_variants_with_best_time_and_char_count(db):
    from app.services import influencer_service
    org, proj = await _org_proj(db)
    content = {"variants": [
        {"platform": "linkedin", "hooks": ["h1", "h2"], "content": "A LinkedIn post", "hashtags": ["#seo"]},
        {"platform": "bogus", "content": "dropped"},
    ]}
    with patch("app.services.influencer_service.run_standalone",
               new=AsyncMock(return_value=AgentResult(ok=True, content=content))):
        out = await influencer_service.generate_studio(proj.id, org.id, "Launch", ["linkedin"], "professional", None, db)
    assert out["ok"] is True and len(out["variants"]) == 1
    v = out["variants"][0]
    assert v["platform"] == "linkedin" and v["hooks"] == ["h1", "h2"]
    assert v["char_count"] == len("A LinkedIn post") and v["best_time"] == influencer_service.BEST_TIMES["linkedin"]


async def test_studio_missing_topic_short_circuits(db):
    from app.services import influencer_service
    org, proj = await _org_proj(db)
    out = await influencer_service.generate_studio(proj.id, org.id, "  ", ["linkedin"], "professional", None, db)
    assert out == {"ok": False, "error": "missing_topic", "variants": []}
