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

# Real HTML with two signals extract_from_page derives deterministically (no
# LLM involved): the <html lang="en"> attribute -> business.language, and a
# generator meta tag naming WordPress -> business.cms. Used to prove the
# crawler's raw text_html field actually reaches the extractors, rather than
# the pipeline's hardcoded "domain" assignment passing the test on its own.
FAKE_HTML = (
    '<html lang="en"><head>'
    '<meta name="generator" content="WordPress 6.4">'
    "<title>Acme Cafe</title>"
    '</head><body><nav><a href="/about">About</a></nav></body></html>'
)


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _seed(org_slug: str, url, description=None):
    org_id = uuid.uuid4()
    run_id = uuid.uuid4()
    async with TestSessionLocal() as db:
        db.add(Organization(id=org_id, slug=org_slug, name=org_slug))
        db.add(DiscoveryRun(id=run_id, org_id=org_id, input_url=url,
                             input_description=description, result={}))
        await db.commit()
    return org_id, run_id


async def _get_run(run_id):
    async with TestSessionLocal() as db:
        return await db.get(DiscoveryRun, run_id)


async def test_pipeline_populates_and_completes(monkeypatch):
    # Route the pipeline's own session factory at the in-memory test engine.
    monkeypatch.setattr(discovery_service, "async_session_factory", TestSessionLocal)

    org_id, run_id = await _seed("acme", "https://acme.test")

    async def fake_fetch(url):
        return {
            "url": url,
            "status_code": 200,
            "internal_links": [{"href": "https://acme.test/about", "text": "About"}],
            "text": "Acme roasts specialty coffee in Lyon.",
            "text_html": FAKE_HTML,
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

    refreshed = await _get_run(run_id)

    assert refreshed.status == "done"
    assert refreshed.progress == 100
    assert refreshed.result["business"]["industry"] == "Coffee"
    assert refreshed.result["business"]["domain"] == "https://acme.test"
    # Proves the crawler's text_html actually flowed into extract_from_page:
    # both signals below only appear if extraction ran against real HTML,
    # not the "" that home.get("text_html") would yield if the field were
    # missing or mis-keyed.
    assert refreshed.result["business"]["cms"] == "WordPress"
    assert refreshed.result["business"]["language"] == "en"


async def test_no_url_path_completes(monkeypatch):
    """Description-only onboarding (no crawl) still reaches a terminal state."""
    monkeypatch.setattr(discovery_service, "async_session_factory", TestSessionLocal)

    org_id, run_id = await _seed("bakery", None, description="A boutique bakery in Nice.")

    async def fake_model(org_id, db):
        return None, None, None

    monkeypatch.setattr(discovery_service, "_org_model", fake_model)

    await discovery_service.run_discovery_pipeline(run_id, fetch=None)

    refreshed = await _get_run(run_id)

    assert refreshed.status == "done"
    assert refreshed.progress == 100
    assert refreshed.stage == "Done"
    assert refreshed.result["business"]["description"] == "A boutique bakery in Nice."


async def test_fetch_failure_terminates_with_error(monkeypatch):
    """A crawler failure still lands the run in a terminal state with an error
    and whatever partial result had already been gathered (the domain)."""
    monkeypatch.setattr(discovery_service, "async_session_factory", TestSessionLocal)

    org_id, run_id = await _seed("acme2", "https://acme2.test")

    async def fake_model(org_id, db):
        return None, None, None

    async def failing_fetch(url):
        raise RuntimeError("crawler unreachable")

    monkeypatch.setattr(discovery_service, "_org_model", fake_model)

    await discovery_service.run_discovery_pipeline(run_id, fetch=failing_fetch)

    refreshed = await _get_run(run_id)

    assert refreshed.status == "done"
    assert refreshed.progress == 100
    assert refreshed.stage == "Done"
    assert refreshed.error is not None
    assert "crawler unreachable" in refreshed.error
    assert refreshed.result["business"]["domain"] == "https://acme2.test"


async def test_org_model_failure_terminates_run(monkeypatch):
    """A failure in the _org_model prelude (e.g. key decryption) must still
    terminate the run rather than leaving it stuck at status="queued"."""
    monkeypatch.setattr(discovery_service, "async_session_factory", TestSessionLocal)

    org_id, run_id = await _seed("acme3", "https://acme3.test")

    async def failing_model(org_id, db):
        raise RuntimeError("key decryption failed")

    monkeypatch.setattr(discovery_service, "_org_model", failing_model)

    await discovery_service.run_discovery_pipeline(run_id, fetch=None)

    refreshed = await _get_run(run_id)

    assert refreshed.status == "done"
    assert refreshed.progress == 100
    assert refreshed.stage == "Done"
    assert refreshed.error is not None
    assert "key decryption failed" in refreshed.error


async def test_set_failure_in_error_handler_does_not_escape(monkeypatch):
    """Even if the terminal _set write itself fails, run_discovery_pipeline
    must not raise (that would leave the row stuck mid-flight, which looks
    alive to the frontend)."""
    monkeypatch.setattr(discovery_service, "async_session_factory", TestSessionLocal)

    org_id, run_id = await _seed("acme4", "https://acme4.test")

    async def failing_model(org_id, db):
        raise RuntimeError("boom")

    async def failing_set(*args, **kwargs):
        raise RuntimeError("db write failed")

    monkeypatch.setattr(discovery_service, "_org_model", failing_model)
    monkeypatch.setattr(discovery_service, "_set", failing_set)

    # Must complete without raising.
    await discovery_service.run_discovery_pipeline(run_id, fetch=None)
