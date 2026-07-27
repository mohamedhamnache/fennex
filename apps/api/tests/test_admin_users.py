import uuid

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.admin_auth import create_admin_token
from app.core.database import Base, get_db
from app.core.security import pwd_context
from app.main import app
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment
from app.models.organization import Organization, PlanTier
from app.models.user import User, UserRole

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_ACME = uuid.uuid4()
ORG_QUIET = uuid.uuid4()
USER_OWNER = uuid.uuid4()
USER_WRITER = uuid.uuid4()
USER_QUIET = uuid.uuid4()
ADMIN_ID: uuid.UUID | None = None


@pytest.fixture(autouse=True)
async def setup_db():
    global ADMIN_ID
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        role = AdminRole(key="super_admin", name="Super Admin", description="")
        admin = AdminUser(email="owner@fennex.io", name="Owner",
                          password_hash=pwd_context.hash("secret"), is_active=True)
        db.add_all([role, admin]); await db.flush()
        db.add(AdminRoleAssignment(admin_user_id=admin.id, role_id=role.id))
        ADMIN_ID = admin.id

        acme = Organization(id=ORG_ACME, slug="acme", name="Acme Co", plan_tier=PlanTier.PRO)
        quiet = Organization(id=ORG_QUIET, slug="quiet", name="Quiet Inc", plan_tier=PlanTier.FREE)
        db.add_all([acme, quiet]); await db.flush()

        db.add_all([
            User(id=USER_OWNER, org_id=ORG_ACME, email="owner@acme.io",
                 hashed_password="x", full_name="Ada Owner",
                 role=UserRole.OWNER, is_active=True, locked=False),
            User(id=USER_WRITER, org_id=ORG_ACME, email="writer@acme.io",
                 hashed_password="x", full_name="Wendy Writer",
                 role=UserRole.CONTENT_WRITER, is_active=True, locked=False),
            User(id=USER_QUIET, org_id=ORG_QUIET, email="viewer@quiet.io",
                 hashed_password="x", full_name="Vic Viewer",
                 role=UserRole.VIEWER, is_active=False, locked=True,
                 locked_reason="fraud"),
        ])
        await db.commit()

    async def _override():
        async with Session() as s:
            yield s
    app.dependency_overrides[get_db] = _override
    yield
    app.dependency_overrides.clear()
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")


def _bearer():
    return create_admin_token(str(ADMIN_ID), ["super_admin"])


async def test_list_users_ok_with_org_name():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/users",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 3
        assert body["page"] == 1
        by_email = {row["email"]: row for row in body["items"]}
        owner = by_email["owner@acme.io"]
        assert owner["full_name"] == "Ada Owner"
        assert owner["role"] == "owner"
        assert owner["org_id"] == str(ORG_ACME)
        assert owner["org_name"] == "Acme Co"
        assert owner["is_active"] is True
        assert owner["locked"] is False

        quiet_user = by_email["viewer@quiet.io"]
        assert quiet_user["org_name"] == "Quiet Inc"
        assert quiet_user["is_active"] is False
        assert quiet_user["locked"] is True


async def test_list_users_filters_by_q():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/users", params={"q": "wendy"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["email"] == "writer@acme.io"

        r2 = await ac.get("/api/v1/admin/users", params={"q": "owner@acme"},
                          headers={"Authorization": f"Bearer {_bearer()}"})
        assert r2.json()["total"] == 1


async def test_list_users_filters_by_role():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/users", params={"role": "content_writer"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["email"] == "writer@acme.io"


async def test_list_users_filters_by_org_id():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/users", params={"org_id": str(ORG_QUIET)},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["email"] == "viewer@quiet.io"


async def test_list_users_filters_by_active_false():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/users", params={"active": "false"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["email"] == "viewer@quiet.io"


async def test_get_user_detail_ok():
    async with await _client() as ac:
        r = await ac.get(f"/api/v1/admin/users/{USER_QUIET}",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["email"] == "viewer@quiet.io"
        assert body["locked_reason"] == "fraud"
        assert body["org"]["id"] == str(ORG_QUIET)
        assert body["org"]["name"] == "Quiet Inc"
        assert body["org"]["slug"] == "quiet"
        assert body["org"]["plan_tier"] == "free"


async def test_get_user_detail_404():
    async with await _client() as ac:
        r = await ac.get(f"/api/v1/admin/users/{uuid.uuid4()}",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 404


async def test_list_users_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/users")
        assert r.status_code == 401
