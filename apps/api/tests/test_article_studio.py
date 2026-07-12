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
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.project import Project
from app.models.analytics import GscConnection
from app.models.api_key import APIKey  # noqa: F401
from app.models.article import Article

# ── Test DB (SQLite in-memory) ────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

SQLITE_COMPATIBLE_TABLES = [
    "projects", "gsc_connections", "api_keys", "articles", "gsc_query_stats",
]

FAKE_ORG_ID = uuid.uuid4()


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
