import uuid, pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.article import Article, ArticleStatus

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


async def test_article_geo_score_column(db):
    org = Organization(slug="o", name="O"); db.add(org); await db.flush()
    proj = Project(org_id=org.id, name="P", domain="p.com"); db.add(proj); await db.flush()
    art = Article(org_id=org.id, project_id=proj.id, title="T", status=ArticleStatus.ready, geo_score=63.0)
    db.add(art); await db.commit(); await db.refresh(art)
    assert art.geo_score == 63.0


# apps/api/tests/test_articles_geo.py  (append — reuses the httpx client pattern from tests/test_images.py)
import uuid
from unittest.mock import patch
from httpx import AsyncClient, ASGITransport
from app.core.dependencies import get_current_user, get_db
from app.main import app
from app.models.user import User, UserRole

ORG = uuid.uuid4(); PROJ = uuid.uuid4()
_user = User(id=uuid.uuid4(), org_id=ORG, email="t@f.ai", hashed_password="x", full_name="T",
             role=UserRole.OWNER, is_active=True)


@pytest.fixture
async def client():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        s.add(Organization(id=ORG, slug="o2", name="O"))
        s.add(Project(id=PROJ, org_id=ORG, name="P", domain="p.com"))
        await s.commit()
    app.dependency_overrides[get_current_user] = lambda: _user
    async def _od():
        async with _Session() as s:
            yield s
    app.dependency_overrides[get_db] = _od
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        yield c
    app.dependency_overrides.clear()
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def _make_article(body: str, geo: float | None = None) -> str:
    async with _Session() as s:
        art = Article(org_id=ORG, project_id=PROJ, title="Best vegan protein",
                      target_keyword="vegan protein", body_markdown=body,
                      status=ArticleStatus.ready, geo_score=geo)
        s.add(art); await s.commit()
        return str(art.id)


async def test_geo_score_endpoint_returns_stored_and_live_breakdown(client):
    aid = await _make_article("# T\n\n- a\n- b\n", geo=88.0)
    r = await client.get(f"/api/v1/articles/{aid}/geo-score")
    assert r.status_code == 200
    body = r.json()
    assert body["geo_score"] == 88.0 and body["breakdown"]["extractable_format"] == 12


async def test_update_recomputes_geo_core(client):
    aid = await _make_article("# T\n\nthin.", geo=None)
    r = await client.patch(f"/api/v1/articles/{aid}",
                           json={"body_markdown": "# T\n\n- one\n- two\n\n## Why?\n\nAccording to a 2023 report, 50% agree."})
    assert r.status_code == 200
    assert r.json()["geo_score"] is not None and r.json()["geo_score"] <= 70
