import uuid
import datetime as dt

import pytest
from httpx import AsyncClient, ASGITransport
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.admin_auth import create_admin_token
from app.core.config import settings
from app.core.database import Base, get_db
from app.core.security import pwd_context
from app.main import app
from app.models.admin_audit_log import AdminAuditLog
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment
from app.models.organization import Organization, PlanTier
from app.models.user import User, UserRole

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_ACME = uuid.uuid4()
ORG_SUSPENDED = uuid.uuid4()
ORG_EMPTY = uuid.uuid4()
ORG_DEACTIVATED_OWNER = uuid.uuid4()
ORG_ALL_INACTIVE = uuid.uuid4()
ADMIN_ID: uuid.UUID | None = None

OWNER_ID: uuid.UUID | None = None
ADMIN_USER_ID: uuid.UUID | None = None
VIEWER_ID: uuid.UUID | None = None
ACTIVE_ADMIN_ID: uuid.UUID | None = None


@pytest.fixture(autouse=True)
async def setup_db():
    global ADMIN_ID, OWNER_ID, ADMIN_USER_ID, VIEWER_ID, ACTIVE_ADMIN_ID
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
        suspended = Organization(id=ORG_SUSPENDED, slug="susp", name="Suspended Co",
                                 plan_tier=PlanTier.FREE,
                                 suspended_at=dt.datetime.now(dt.timezone.utc),
                                 suspended_reason="non-payment")
        empty = Organization(id=ORG_EMPTY, slug="empty", name="Empty Co", plan_tier=PlanTier.FREE)
        deactivated_owner_org = Organization(id=ORG_DEACTIVATED_OWNER, slug="deactowner",
                                             name="Deactivated Owner Co", plan_tier=PlanTier.FREE)
        all_inactive_org = Organization(id=ORG_ALL_INACTIVE, slug="allinactive",
                                        name="All Inactive Co", plan_tier=PlanTier.FREE)
        db.add_all([acme, suspended, empty, deactivated_owner_org, all_inactive_org]); await db.flush()

        # Seed users with DISTINCT roles, VIEWER created first, to prove OWNER
        # is picked over ADMIN/VIEWER regardless of creation order.
        viewer = User(org_id=ORG_ACME, email="viewer@acme.io", hashed_password="x",
                     full_name="Viewer One", role=UserRole.VIEWER)
        admin_user = User(org_id=ORG_ACME, email="admin@acme.io", hashed_password="x",
                          full_name="Admin One", role=UserRole.ADMIN)
        owner = User(org_id=ORG_ACME, email="owner@acme.io", hashed_password="x",
                    full_name="Owner One", role=UserRole.OWNER)
        db.add_all([viewer, admin_user, owner]); await db.flush()
        VIEWER_ID = viewer.id
        ADMIN_USER_ID = admin_user.id
        OWNER_ID = owner.id

        db.add(User(org_id=ORG_SUSPENDED, email="u@susp.io", hashed_password="x",
                    full_name="Susp Owner", role=UserRole.OWNER))

        # Deactivated OWNER must be skipped in favor of an active ADMIN.
        deactivated_owner = User(org_id=ORG_DEACTIVATED_OWNER, email="deactowner@d.io",
                                 hashed_password="x", full_name="Deactivated Owner",
                                 role=UserRole.OWNER, is_active=False)
        active_admin = User(org_id=ORG_DEACTIVATED_OWNER, email="activeadmin@d.io",
                            hashed_password="x", full_name="Active Admin",
                            role=UserRole.ADMIN, is_active=True)
        db.add_all([deactivated_owner, active_admin]); await db.flush()
        ACTIVE_ADMIN_ID = active_admin.id

        # Org where the ONLY user is a deactivated OWNER -- no active user
        # anywhere -- must 404.
        db.add(User(org_id=ORG_ALL_INACTIVE, email="onlyowner@ai.io", hashed_password="x",
                    full_name="Only Deactivated Owner", role=UserRole.OWNER, is_active=False))
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


async def _audit_rows(db: AsyncSession, action: str) -> list[AdminAuditLog]:
    return (await db.execute(select(AdminAuditLog).where(AdminAuditLog.action == action))).scalars().all()


async def test_impersonate_picks_owner_and_mints_token_with_claims():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{ORG_ACME}/impersonate",
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 200
        body = r.json()

        assert body["token_type"] == "bearer"
        assert body["expires_in"] == 1800
        assert body["user"]["id"] == str(OWNER_ID)
        assert body["user"]["email"] == "owner@acme.io"
        assert body["user"]["full_name"] == "Owner One"

        payload = jwt.decode(body["access_token"], settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        assert payload["sub"] == str(OWNER_ID)
        assert payload["org_id"] == str(ORG_ACME)
        assert payload["role"] == "owner"
        assert payload["imp"] == str(ADMIN_ID)

    async with Session() as db:
        rows = await _audit_rows(db, "org.impersonate")
        assert len(rows) == 1
        assert rows[0].resource_type == "organization"
        assert rows[0].resource_id == str(ORG_ACME)
        assert rows[0].after_json == {"impersonated_user": str(OWNER_ID)}
        assert rows[0].actor_admin_id == ADMIN_ID


async def test_impersonate_forbidden_for_auditor():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{ORG_ACME}/impersonate",
                          headers={"Authorization": f"Bearer {_auditor_bearer()}"})
        assert r.status_code == 403

    async with Session() as db:
        rows = await _audit_rows(db, "org.impersonate")
        assert len(rows) == 0


async def test_impersonate_suspended_org_409():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{ORG_SUSPENDED}/impersonate",
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 409

    async with Session() as db:
        rows = await _audit_rows(db, "org.impersonate")
        assert len(rows) == 0


async def test_impersonate_org_with_no_users_404():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{ORG_EMPTY}/impersonate",
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 404


async def test_impersonate_unknown_org_404():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{uuid.uuid4()}/impersonate",
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 404


async def test_impersonate_skips_deactivated_owner_for_active_admin():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{ORG_DEACTIVATED_OWNER}/impersonate",
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 200
        body = r.json()

        # Must pick the ACTIVE admin, never the deactivated owner.
        assert body["user"]["id"] == str(ACTIVE_ADMIN_ID)

        payload = jwt.decode(body["access_token"], settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        assert payload["sub"] == str(ACTIVE_ADMIN_ID)


async def test_impersonate_all_users_inactive_404():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{ORG_ALL_INACTIVE}/impersonate",
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 404
