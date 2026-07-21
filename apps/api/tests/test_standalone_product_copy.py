import uuid, pytest
from unittest.mock import AsyncMock, patch
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.store_product import StoreProduct
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


async def _fixture(db):
    org = Organization(slug=f"o{uuid.uuid4().hex[:6]}", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com", persona="ecommerce"); db.add(proj); await db.flush()
    prod = StoreProduct(org_id=org.id, project_id=proj.id, source="shopify", external_id="1",
                        title="Serum", price="19", description="A serum"); db.add(prod)
    await db.commit(); return org, proj, prod


async def test_generate_copy_maps_result(db):
    from app.services import store_service
    org, proj, prod = await _fixture(db)
    res = AgentResult(ok=True, content={"title": "Best Serum", "description_html": "<p>Glow</p>",
                                        "meta_description": "Buy the best serum."})
    with patch("app.services.agents.standalone.run_standalone", new=AsyncMock(return_value=res)):
        out = await store_service.generate_copy(prod.id, proj.id, org.id, db)
    assert out == {"ok": True, "title": "Best Serum", "description_html": "<p>Glow</p>",
                   "meta_description": "Buy the best serum."}


async def test_generate_copy_not_found(db):
    from app.services import store_service
    org, proj, prod = await _fixture(db)
    out = await store_service.generate_copy(uuid.uuid4(), proj.id, org.id, db)
    assert out == {"ok": False, "error": "not_found"}


async def test_generate_copy_falls_back_to_product_title(db):
    from app.services import store_service
    org, proj, prod = await _fixture(db)
    res = AgentResult(ok=True, content={"description_html": "<p>x</p>"})  # no title
    with patch("app.services.agents.standalone.run_standalone", new=AsyncMock(return_value=res)):
        out = await store_service.generate_copy(prod.id, proj.id, org.id, db)
    assert out["ok"] is True and out["title"] == "Serum"
