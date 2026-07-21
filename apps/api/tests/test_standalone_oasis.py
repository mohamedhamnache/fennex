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


async def _org_proj(db, tier=None):
    org = Organization(slug=f"o{uuid.uuid4().hex[:6]}", name="O", agent_tier=tier); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="Acme", domain="acme.com", persona="ecommerce"); db.add(proj)
    await db.commit(); return org, proj


async def test_market_report_maps_ok_result(db):
    from app.services import oasis_service
    org, proj = await _org_proj(db)
    res = AgentResult(ok=True, summary="report", content="# Report\n\nBody")
    with patch("app.services.oasis_service.run_standalone", new=AsyncMock(return_value=res)):
        out = await oasis_service.generate_market_report(proj.id, org.id, db)
    assert out["ok"] is True and out["markdown"] == "# Report\n\nBody"
    assert out["title"] == "Acme — Market Report" and "generated_at" in out


async def test_market_report_maps_error(db):
    from app.services import oasis_service
    org, proj = await _org_proj(db)
    res = AgentResult(ok=False, error="No AI key configured.")
    with patch("app.services.oasis_service.run_standalone", new=AsyncMock(return_value=res)):
        out = await oasis_service.generate_market_report(proj.id, org.id, db)
    assert out["ok"] is False and "AI key" in out["error"]


async def test_icp_maps_and_sanitizes_segments(db):
    from app.services import oasis_service
    org, proj = await _org_proj(db)
    content = {"segments": [
        {"name": "Boutique DTC brands", "description": "Small ecommerce teams.",
         "pains": ["low traffic", "thin content", "", "a", "b", "c"],
         "channels": ["LinkedIn", "SEO", "x", "y"], "angle": "Rank without an agency."},
        {"name": "", "description": "no name -> dropped"},
    ]}
    res = AgentResult(ok=True, summary="icp", content=content)
    with patch("app.services.oasis_service.run_standalone", new=AsyncMock(return_value=res)):
        out = await oasis_service.generate_icp(proj.id, org.id, db)
    assert out["ok"] is True and len(out["segments"]) == 1
    seg = out["segments"][0]
    assert seg["name"] == "Boutique DTC brands"
    assert len(seg["pains"]) == 4 and len(seg["channels"]) == 3


async def test_icp_bad_content_errors(db):
    from app.services import oasis_service
    org, proj = await _org_proj(db)
    with patch("app.services.oasis_service.run_standalone",
               new=AsyncMock(return_value=AgentResult(ok=True, content={"segments": []}))):
        out = await oasis_service.generate_icp(proj.id, org.id, db)
    assert out["ok"] is False and out["error"] == "bad_format"
