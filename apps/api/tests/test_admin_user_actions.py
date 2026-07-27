import uuid

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.admin_auth import create_admin_token
from app.core.database import Base, get_db
from app.core.security import create_access_token, pwd_context
from app.main import app
from app.models.admin_audit_log import AdminAuditLog
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment
from app.models.organization import Organization, PlanTier
from app.models.user import User, UserRole

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_ACME = uuid.uuid4()
ADMIN_ID: uuid.UUID | None = None
TARGET_USER_ID: uuid.UUID | None = None


@pytest.fixture(autouse=True)
async def setup_db():
    global ADMIN_ID, TARGET_USER_ID
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        role = AdminRole(key="super_admin", name="Super Admin", description="")
        auditor_role = AdminRole(key="auditor", name="Auditor", description="")
        admin = AdminUser(email="owner@fennex.io", name="Owner",
                          password_hash=pwd_context.hash("secret"), is_active=True)
        db.add_all([role, auditor_role, admin]); await db.flush()
        db.add(AdminRoleAssignment(admin_user_id=admin.id, role_id=role.id))
        ADMIN_ID = admin.id

        acme = Organization(id=ORG_ACME, slug="acme", name="Acme Co", plan_tier=PlanTier.PRO)
        db.add(acme); await db.flush()

        target = User(
            org_id=ORG_ACME,
            email="target@acme.com",
            hashed_password="x",
            full_name="Target User",
            role=UserRole.VIEWER,
            is_active=True,
            locked=False,
        )
        db.add(target); await db.flush()
        TARGET_USER_ID = target.id

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


def _super_bearer():
    return create_admin_token(str(ADMIN_ID), ["super_admin"])


def _auditor_bearer():
    return create_admin_token(str(ADMIN_ID), ["auditor"])


async def _get_user(db: AsyncSession, user_id: uuid.UUID) -> User:
    return (await db.execute(select(User).where(User.id == user_id))).scalar_one()


async def _audit_rows(db: AsyncSession, action: str) -> list[AdminAuditLog]:
    return (await db.execute(select(AdminAuditLog).where(AdminAuditLog.action == action))).scalars().all()


# ------------------------------------------------------------- deactivate ---

async def test_deactivate_ok_super_admin():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/deactivate",
                          json={"reason": "abuse"},
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 200

    async with Session() as db:
        user = await _get_user(db, TARGET_USER_ID)
        assert user.is_active is False

        rows = await _audit_rows(db, "user.deactivate")
        assert len(rows) == 1
        assert rows[0].resource_type == "user"
        assert rows[0].resource_id == str(TARGET_USER_ID)
        assert rows[0].actor_admin_id == ADMIN_ID


async def test_deactivate_forbidden_for_auditor_no_state_change_no_audit():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/deactivate",
                          json={"reason": "abuse"},
                          headers={"Authorization": f"Bearer {_auditor_bearer()}"})
        assert r.status_code == 403

    async with Session() as db:
        user = await _get_user(db, TARGET_USER_ID)
        assert user.is_active is True

        rows = await _audit_rows(db, "user.deactivate")
        assert len(rows) == 0


async def test_deactivate_already_inactive_is_noop():
    async with await _client() as ac:
        headers = {"Authorization": f"Bearer {_super_bearer()}"}
        r1 = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/deactivate",
                           json={"reason": "abuse"}, headers=headers)
        assert r1.status_code == 200
        r2 = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/deactivate",
                           json={"reason": "different"}, headers=headers)
        assert r2.status_code == 200

    async with Session() as db:
        rows = await _audit_rows(db, "user.deactivate")
        assert len(rows) == 1


async def test_deactivate_404_unknown_user():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/users/{uuid.uuid4()}/deactivate",
                          json={"reason": "abuse"},
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 404


# ------------------------------------------------------------- reactivate ---

async def test_reactivate_sets_active_and_audits():
    async with await _client() as ac:
        headers = {"Authorization": f"Bearer {_super_bearer()}"}
        r1 = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/deactivate",
                           json={"reason": "abuse"}, headers=headers)
        assert r1.status_code == 200

        r2 = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/reactivate", headers=headers)
        assert r2.status_code == 200

    async with Session() as db:
        user = await _get_user(db, TARGET_USER_ID)
        assert user.is_active is True

        rows = await _audit_rows(db, "user.reactivate")
        assert len(rows) == 1


async def test_reactivate_forbidden_for_auditor():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/reactivate",
                          headers={"Authorization": f"Bearer {_auditor_bearer()}"})
        assert r.status_code == 403


async def test_reactivate_404_unknown_user():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/users/{uuid.uuid4()}/reactivate",
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 404


# ------------------------------------------------------------------- lock ---

async def test_lock_sets_locked_and_reason_and_audits():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/lock",
                          json={"reason": "fraud"},
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 200

    async with Session() as db:
        user = await _get_user(db, TARGET_USER_ID)
        assert user.locked is True
        assert user.locked_reason == "fraud"

        rows = await _audit_rows(db, "user.lock")
        assert len(rows) == 1
        assert rows[0].resource_type == "user"
        assert rows[0].resource_id == str(TARGET_USER_ID)


async def test_lock_forbidden_for_auditor_no_state_change_no_audit():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/lock",
                          json={"reason": "fraud"},
                          headers={"Authorization": f"Bearer {_auditor_bearer()}"})
        assert r.status_code == 403

    async with Session() as db:
        user = await _get_user(db, TARGET_USER_ID)
        assert user.locked is False

        rows = await _audit_rows(db, "user.lock")
        assert len(rows) == 0


async def test_lock_404_unknown_user():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/users/{uuid.uuid4()}/lock",
                          json={"reason": "fraud"},
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 404


# ----------------------------------------------------------------- unlock ---

async def test_unlock_clears_locked_and_reason_and_audits():
    async with await _client() as ac:
        headers = {"Authorization": f"Bearer {_super_bearer()}"}
        r1 = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/lock",
                           json={"reason": "fraud"}, headers=headers)
        assert r1.status_code == 200

        r2 = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/unlock", headers=headers)
        assert r2.status_code == 200

    async with Session() as db:
        user = await _get_user(db, TARGET_USER_ID)
        assert user.locked is False
        assert user.locked_reason is None

        rows = await _audit_rows(db, "user.unlock")
        assert len(rows) == 1


async def test_unlock_forbidden_for_auditor():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/users/{TARGET_USER_ID}/unlock",
                          headers={"Authorization": f"Bearer {_auditor_bearer()}"})
        assert r.status_code == 403


async def test_unlock_404_unknown_user():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/users/{uuid.uuid4()}/unlock",
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 404


# ---------------------------------------------------- customer-auth enforcement ---

async def test_deactivated_user_blocked_from_customer_auth():
    token = create_access_token({
        "sub": str(TARGET_USER_ID), "org_id": str(ORG_ACME), "role": UserRole.VIEWER.value,
    })
    async with Session() as db:
        user = await _get_user(db, TARGET_USER_ID)
        user.is_active = False
        await db.commit()

    async with await _client() as ac:
        resp = await ac.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403


async def test_locked_user_blocked_from_customer_auth():
    token = create_access_token({
        "sub": str(TARGET_USER_ID), "org_id": str(ORG_ACME), "role": UserRole.VIEWER.value,
    })
    async with Session() as db:
        user = await _get_user(db, TARGET_USER_ID)
        user.locked = True
        await db.commit()

    async with await _client() as ac:
        resp = await ac.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403


async def test_active_unlocked_user_allowed_customer_auth():
    token = create_access_token({
        "sub": str(TARGET_USER_ID), "org_id": str(ORG_ACME), "role": UserRole.VIEWER.value,
    })
    async with await _client() as ac:
        resp = await ac.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
