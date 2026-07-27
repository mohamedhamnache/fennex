import datetime as dt
import uuid

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.admin_auth import create_admin_token
from app.core.database import Base, get_db
from app.core.security import pwd_context
from app.main import app
from app.models.admin_audit_log import AdminAuditLog
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ADMIN_ID: uuid.UUID | None = None
OTHER_ACTOR_ID = uuid.uuid4()

NOW = dt.datetime.now(dt.timezone.utc)

RESOURCE_ID_1 = str(uuid.uuid4())
RESOURCE_ID_2 = str(uuid.uuid4())


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

        db.add_all([
            AdminAuditLog(
                actor_admin_id=admin.id, action="org.suspend",
                resource_type="organization", resource_id=RESOURCE_ID_1,
                before_json={"suspended": False}, after_json={"suspended": True},
                ip="10.0.0.1", result="ok",
                created_at=NOW - dt.timedelta(minutes=10),
            ),
            AdminAuditLog(
                actor_admin_id=OTHER_ACTOR_ID, action="org.plan",
                resource_type="organization", resource_id=RESOURCE_ID_2,
                before_json={"plan": "free"}, after_json={"plan": "pro"},
                ip="10.0.0.2", result="ok",
                created_at=NOW - dt.timedelta(minutes=5),
            ),
            AdminAuditLog(
                actor_admin_id=admin.id, action="org.reset_quotas",
                resource_type="organization", resource_id=RESOURCE_ID_1,
                before_json=None, after_json=None,
                ip="10.0.0.1", result="ok",
                created_at=NOW,
            ),
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


async def test_list_returns_all_newest_first():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/audit",
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 3
        assert len(body["items"]) == 3
        actions = [item["action"] for item in body["items"]]
        assert actions == ["org.reset_quotas", "org.plan", "org.suspend"]
        item = body["items"][0]
        assert set(item.keys()) == {
            "id", "actor_admin_id", "action", "resource_type", "resource_id",
            "before_json", "after_json", "ip", "result", "created_at",
        }


async def test_filter_by_action():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/audit", params={"action": "org.plan"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["action"] == "org.plan"


async def test_filter_by_resource_id():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/audit", params={"resource_id": RESOURCE_ID_1},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 2
        for item in body["items"]:
            assert item["resource_id"] == RESOURCE_ID_1


async def test_without_token_401():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/audit")
        assert r.status_code == 401


async def test_filter_by_actor_returns_only_that_actors_rows():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/audit", params={"actor": str(OTHER_ACTOR_ID)},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 200
        body = r.json()
        assert body["total"] == 1
        assert body["items"][0]["actor_admin_id"] == str(OTHER_ACTOR_ID)


async def test_filter_by_invalid_actor_422():
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/audit", params={"actor": "not-a-uuid"},
                         headers={"Authorization": f"Bearer {_bearer()}"})
        assert r.status_code == 422
