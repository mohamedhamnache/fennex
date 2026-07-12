"""
Tests for Article Studio — Task 1: writing_service (selection transforms + Dune chat).

Strategy (mirrors test_seo_intel.py):
- In-memory SQLite (aiosqlite) engine, own session factory
- Create only the SQLite-compatible tables this feature touches
"""
import types
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.project import Project
from app.models.analytics import GscConnection
from app.models.api_key import APIKey  # noqa: F401
from app.models.article import Article
from app.models.user import User, UserRole

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "projects", "gsc_connections", "api_keys", "articles", "gsc_query_stats",
]

FAKE_ORG_ID = uuid.uuid4()
FAKE_USER_ID = uuid.uuid4()

fake_user = User(
    id=FAKE_USER_ID,
    org_id=FAKE_ORG_ID,
    email="test@fennex.ai",
    hashed_password="hashed",
    full_name="Test User",
    role=UserRole.OWNER,
    is_active=True,
)


async def override_get_current_user():
    return fake_user


@pytest.fixture(autouse=True)
async def setup_db():
    tables = [
        Base.metadata.tables[name]
        for name in SQLITE_COMPATIBLE_TABLES
        if name in Base.metadata.tables
    ]
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all, tables=tables)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, tables=tables)


@pytest.fixture
async def db_session():
    async with TestSessionLocal() as session:
        yield session


async def override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _mk_project(db, persona="creator", enabled=True, gsc=True):
    p = Project(org_id=FAKE_ORG_ID, name="P", domain="pure-saveur.fr", persona=persona,
                autopilot_enabled=enabled)
    db.add(p); await db.commit(); await db.refresh(p)
    if gsc:
        db.add(GscConnection(project_id=p.id, org_id=FAKE_ORG_ID, is_active=True))
        await db.commit()
    return p


async def _mk_article(db, project, title="Menu digital", keyword="menu digital", body="# T\n\nIntro."):
    a = Article(org_id=FAKE_ORG_ID, project_id=project.id, title=title,
                target_keyword=keyword, body_markdown=body)
    db.add(a); await db.commit(); await db.refresh(a)
    return a


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_transform_modes_and_limits(db_session):
    from app.services import writing_service as ws
    p = await _mk_project(db_session)
    with patch.object(ws, "get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "k"})), \
         patch.object(ws, "call_llm", new=AsyncMock(return_value="  Texte reformule.  ")) as m:
        out = await ws.transform(p, "humanize", "Un texte robotique.", db_session)
    assert out == "Texte reformule."
    sys_prompt = m.call_args.args[3]
    assert "human" in sys_prompt.lower()
    with pytest.raises(ValueError):
        await ws.transform(p, "unknown", "x", db_session)
    with pytest.raises(ValueError):
        await ws.transform(p, "rephrase", "   ", db_session)
    with pytest.raises(ws.TextTooLong):
        await ws.transform(p, "rephrase", "x" * 6001, db_session)
    with patch.object(ws, "get_org_llm_keys", new=AsyncMock(return_value={})):
        with pytest.raises(RuntimeError):
            await ws.transform(p, "rephrase", "ok", db_session)


@pytest.mark.asyncio
async def test_chat_grounds_and_extracts_insertable(db_session):
    from app.services import writing_service as ws
    p = await _mk_project(db_session)
    art = await _mk_article(db_session, p)
    reply = "Here is a section.\n<draft>## Pourquoi un menu digital\nLe contenu...</draft>"
    with patch.object(ws, "get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "k"})), \
         patch.object(ws, "call_llm", new=AsyncMock(return_value=reply)) as m:
        res = await ws.chat(p, art, "Write the section", [{"role": "user", "content": "hi"}] * 12, db_session)
    assert res["insertable"].startswith("## Pourquoi")
    assert "<draft>" not in res["answer"]
    user_prompt = m.call_args.args[4]
    assert "Menu digital" in user_prompt            # grounded in the article
    assert user_prompt.count("user:") <= 8          # history capped


# ── Task 2: checks_service (seo_checklist + ai_patterns) ────────────────────

def test_seo_checklist_statuses():
    from app.services.checks_service import seo_checklist
    art = types.SimpleNamespace(
        title="Menu digital restaurant: le guide",           # 32 chars -> pass
        meta_description="Trop court",                        # fail
        body_markdown=(
            "Le menu digital change tout pour votre restaurant.\n\n"  # intro w/ kw -> pass
            "## Pourquoi le menu digital\n\ncontenu " + ("mot " * 130) + "\n\n"  # long paragraph -> warn
            "## Prix\n\nVoir [tarifs](https://x.fr) et [demo](https://y.fr).\n\n"
            "![](https://img.fr/a.png)\n"                     # empty alt -> fail
        ),
    )
    res = {c["id"]: c["status"] for c in seo_checklist(art, "menu digital")}
    assert res["title_length"] == "pass" and res["kw_in_title"] == "pass"
    assert res["meta_length"] == "fail"
    assert res["kw_in_intro"] == "pass" and res["kw_in_heading"] == "pass"
    assert res["headings_count"] == "fail"      # only 2 headings
    assert res["links"] == "pass"
    assert res["image_alts"] == "fail"
    assert res["paragraph_length"] == "warn"
    res2 = {c["id"]: c["status"] for c in seo_checklist(art, None)}
    assert res2["kw_in_title"] == "warn"


def test_ai_patterns_signals_and_score():
    from app.services.checks_service import ai_patterns
    robotic = ("This is a sentence with seven words here. " * 5 +
               "This is another sentence counting seven words. " * 4 +
               "Furthermore, it's important to note the value. ")
    res = ai_patterns(robotic, "en")
    ids = {s["id"] for s in res["signals"]}
    assert "burstiness" in ids and "repeated_openers" in ids and "cliches" in ids
    assert res["score"] <= 40
    assert any("This" in f["reason"] or "cliche" in f["reason"].lower() for f in res["flagged"])
    human = ("Short one. Then a much longer sentence that wanders through several ideas before landing. "
             "Why? Because rhythm matters. People notice texture in writing, even when they cannot name it.")
    assert ai_patterns(human, "en")["score"] >= 80


# ── Task 3: checks_service (plagiarism_scan) ────────────────────────────────

@pytest.mark.asyncio
async def test_plagiarism_scan_matches_and_gate(db_session):
    from app.services import checks_service as cs
    p = await _mk_project(db_session)
    # "Une phrase ... test." is a genuine 12-word body sentence (10-20 word
    # window) with no reliance on the heading gluing onto it — the heading
    # line ("# Titre") must be stripped before sentence-splitting, not
    # smuggled in as part of the sampled sentence.
    body = ("# Titre\n\n"
            + "Une phrase distinctive contenant plusieurs mots relativement caracteristiques assembles pour le test. " * 3
            + "Court. " * 5)
    art = await _mk_article(db_session, p, body=body)

    class Prov:
        def __init__(self):
            self.calls: list[str] = []

        async def serp(self, kw, language_code="en", location_code=2840):
            self.calls.append(kw)
            return [{"type": "organic", "rank_absolute": 1, "domain": "copycat.com",
                     "url": "https://copycat.com/page", "title": "t"}]
    prov = Prov()
    with patch.object(cs, "get_seo_provider_for_org", new=AsyncMock(return_value=prov)):
        res = await cs.plagiarism_scan(p, art, db_session)
    assert res["checked"] >= 1
    assert res["matches"] and res["matches"][0]["urls"] == ["https://copycat.com/page"]
    # Regression: no sampled/queried sentence should ever contain heading
    # markup — proves headings are stripped before sentence-splitting.
    assert all("#" not in kw for kw in prov.calls)

    class OwnProv:
        async def serp(self, kw, language_code="en", location_code=2840):
            return [{"type": "organic", "rank_absolute": 1, "domain": "pure-saveur.fr",
                     "url": "https://pure-saveur.fr/x", "title": "t"}]
    with patch.object(cs, "get_seo_provider_for_org", new=AsyncMock(return_value=OwnProv())):
        res = await cs.plagiarism_scan(p, art, db_session)
    assert res["matches"] == []                      # own domain doesn't count

    with patch.object(cs, "get_seo_provider_for_org", new=AsyncMock(return_value=None)):
        with pytest.raises(cs.NoProvider):
            await cs.plagiarism_scan(p, art, db_session)


# ── Task 4: /articles/{id}/{transform,chat,checks,plagiarism} router ───────

@pytest.mark.asyncio
async def test_transform_endpoint_200_400_404(client, db_session):
    from app.services import writing_service as ws
    p = await _mk_project(db_session)
    art = await _mk_article(db_session, p)

    with patch.object(ws, "get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "k"})), \
         patch.object(ws, "call_llm", new=AsyncMock(return_value="  Rewritten.  ")):
        r = await client.post(f"/api/v1/articles/{art.id}/transform", json={"mode": "rephrase", "text": "hi"})
    assert r.status_code == 200, r.text
    assert r.json() == {"text": "Rewritten."}

    r = await client.post(f"/api/v1/articles/{art.id}/transform", json={"mode": "bogus", "text": "hi"})
    assert r.status_code == 400

    r = await client.post(f"/api/v1/articles/{uuid.uuid4()}/transform", json={"mode": "rephrase", "text": "hi"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_transform_endpoint_too_long_and_no_key(client, db_session):
    from app.services import writing_service as ws
    p = await _mk_project(db_session)
    art = await _mk_article(db_session, p)

    r = await client.post(f"/api/v1/articles/{art.id}/transform", json={"mode": "rephrase", "text": "x" * 6001})
    assert r.status_code == 413

    with patch.object(ws, "get_org_llm_keys", new=AsyncMock(return_value={})):
        r = await client.post(f"/api/v1/articles/{art.id}/transform", json={"mode": "rephrase", "text": "hi"})
    assert r.status_code == 400
    assert r.json()["detail"] == "No AI key configured. Add an Anthropic or OpenAI key in Settings."


@pytest.mark.asyncio
async def test_chat_endpoint(client, db_session):
    from app.services import writing_service as ws
    p = await _mk_project(db_session)
    art = await _mk_article(db_session, p)

    reply = "Sure.\n<draft>## Section\ncontent</draft>"
    with patch.object(ws, "get_org_llm_keys", new=AsyncMock(return_value={"anthropic": "k"})), \
         patch.object(ws, "call_llm", new=AsyncMock(return_value=reply)):
        r = await client.post(f"/api/v1/articles/{art.id}/chat",
                               json={"question": "Write it", "history": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["insertable"].startswith("## Section")
    assert "<draft>" not in body["answer"]

    r = await client.post(f"/api/v1/articles/{uuid.uuid4()}/chat", json={"question": "hi"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_checks_endpoint_shape(client, db_session):
    p = await _mk_project(db_session)
    art = await _mk_article(db_session, p, body="# T\n\nIntro with menu digital.\n\n## H2\n\ncontent")

    r = await client.post(f"/api/v1/articles/{art.id}/checks")
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body["seo"], list) and len(body["seo"]) > 0
    assert "score" in body["ai"] and "signals" in body["ai"] and "flagged" in body["ai"]

    r = await client.post(f"/api/v1/articles/{uuid.uuid4()}/checks")
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_plagiarism_endpoint_409_no_provider(client, db_session):
    from app.services import checks_service as cs
    p = await _mk_project(db_session)
    art = await _mk_article(db_session, p)

    with patch.object(cs, "get_seo_provider_for_org", new=AsyncMock(return_value=None)):
        r = await client.post(f"/api/v1/articles/{art.id}/plagiarism")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "no_seo_provider"

    r = await client.post(f"/api/v1/articles/{uuid.uuid4()}/plagiarism")
    assert r.status_code == 404
