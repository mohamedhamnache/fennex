"""
Tests for Article Studio — Task 1: writing_service (selection transforms + Dune chat).

Strategy (mirrors test_seo_intel.py):
- In-memory SQLite (aiosqlite) engine, own session factory
- Create only the SQLite-compatible tables this feature touches
"""
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
