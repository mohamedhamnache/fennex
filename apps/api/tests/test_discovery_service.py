import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.discovery import DiscoveryRun
from app.models.organization import Organization
from app.services import competitor_service, discovery_service
from app.services.discovery import synthesis

test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def test_pipeline_populates_and_completes(monkeypatch):
    # Route the pipeline's own session factory at the in-memory test engine.
    monkeypatch.setattr(discovery_service, "async_session_factory", TestSessionLocal)

    org_id = uuid.uuid4()
    run_id = uuid.uuid4()
    async with TestSessionLocal() as db:
        db.add(Organization(id=org_id, slug="acme", name="Acme"))
        db.add(DiscoveryRun(id=run_id, org_id=org_id, input_url="https://acme.test", result={}))
        await db.commit()

    async def fake_fetch(url):
        return {
            "url": url,
            "status_code": 200,
            "internal_links": [{"href": "https://acme.test/about", "text": "About"}],
            "text": "Acme roasts specialty coffee in Lyon.",
            "title": "Acme Cafe",
            "h2": ["Our beans"],
            "word_count": 400,
        }

    async def fake_synth(text, partial, **kw):
        partial["business"]["industry"] = "Coffee"
        return partial

    async def fake_model(org_id, db):
        return "anthropic", "claude-opus-4-8", "key"

    async def fake_scorecard(url):
        return {"score": 80, "title": "Acme Cafe", "meta_description": "desc", "word_count": 400}

    monkeypatch.setattr(synthesis, "synthesise", fake_synth)
    monkeypatch.setattr(discovery_service, "_org_model", fake_model)
    monkeypatch.setattr(competitor_service, "scan_scorecard", fake_scorecard)

    await discovery_service.run_discovery_pipeline(run_id, fetch=fake_fetch)

    async with TestSessionLocal() as db:
        refreshed = await db.get(DiscoveryRun, run_id)

    assert refreshed.status == "done"
    assert refreshed.progress == 100
    assert refreshed.result["business"]["industry"] == "Coffee"
    assert refreshed.result["business"]["domain"] == "https://acme.test"
