import uuid
import datetime as dt

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.admin_auth import create_admin_token
from app.core.database import Base, get_db
from app.core.security import pwd_context
from app.main import app
from app.models.admin_audit_log import AdminAuditLog
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment
from app.models.organization import Organization, PlanTier
from app.models.billing import OrgUsage

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

ORG_ACME = uuid.uuid4()
ADMIN_ID: uuid.UUID | None = None

TODAY = dt.date.today()
PERIOD_CURRENT = TODAY.replace(day=1)
PERIOD_PREVIOUS = PERIOD_CURRENT - dt.timedelta(days=31)


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

        acme = Organization(id=ORG_ACME, slug="acme", name="Acme Co",
                            plan_tier=PlanTier.PRO)
        db.add(acme); await db.flush()

        # Usage split across TWO periods -- reset-quotas must zero every row,
        # not just the "current" one, and the audit `before` must be the SUM.
        db.add_all([
            OrgUsage(org_id=ORG_ACME, period_start=PERIOD_CURRENT,
                    ai_input_tokens=1000, ai_output_tokens=500, ai_requests=100,
                    seo_serp=10, seo_keyword_analyses=4, cost_micros=500_000),
            OrgUsage(org_id=ORG_ACME, period_start=PERIOD_PREVIOUS,
                    ai_input_tokens=2000, ai_output_tokens=750, ai_requests=50,
                    seo_serp=5, seo_keyword_analyses=2, cost_micros=250_000),
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


def _super_bearer():
    return create_admin_token(str(ADMIN_ID), ["super_admin"])


def _auditor_bearer():
    return create_admin_token(str(ADMIN_ID), ["auditor"])


async def _get_org(db: AsyncSession, org_id: uuid.UUID) -> Organization:
    return (await db.execute(select(Organization).where(Organization.id == org_id))).scalar_one()


async def _audit_rows(db: AsyncSession, action: str) -> list[AdminAuditLog]:
    return (await db.execute(select(AdminAuditLog).where(AdminAuditLog.action == action))).scalars().all()


# ---------------------------------------------------------------- suspend ---

async def test_suspend_ok_super_admin():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{ORG_ACME}/suspend",
                          json={"reason": "abuse"},
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 200

    async with Session() as db:
        org = await _get_org(db, ORG_ACME)
        assert org.suspended_at is not None
        assert org.suspended_reason == "abuse"

        rows = await _audit_rows(db, "org.suspend")
        assert len(rows) == 1
        assert rows[0].resource_type == "organization"
        assert rows[0].resource_id == str(ORG_ACME)
        assert rows[0].before_json == {"suspended": False}
        assert rows[0].after_json == {"suspended": True, "reason": "abuse"}
        assert rows[0].actor_admin_id == ADMIN_ID


async def test_suspend_forbidden_for_auditor_no_state_change_no_audit():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{ORG_ACME}/suspend",
                          json={"reason": "abuse"},
                          headers={"Authorization": f"Bearer {_auditor_bearer()}"})
        assert r.status_code == 403

    async with Session() as db:
        org = await _get_org(db, ORG_ACME)
        assert org.suspended_at is None
        assert org.suspended_reason is None

        rows = await _audit_rows(db, "org.suspend")
        assert len(rows) == 0


async def test_suspend_already_suspended_is_noop():
    async with await _client() as ac:
        headers = {"Authorization": f"Bearer {_super_bearer()}"}
        r1 = await ac.post(f"/api/v1/admin/orgs/{ORG_ACME}/suspend",
                           json={"reason": "abuse"}, headers=headers)
        assert r1.status_code == 200
        r2 = await ac.post(f"/api/v1/admin/orgs/{ORG_ACME}/suspend",
                           json={"reason": "different reason"}, headers=headers)
        assert r2.status_code == 200

    async with Session() as db:
        org = await _get_org(db, ORG_ACME)
        # Original reason preserved -- second call was a true no-op.
        assert org.suspended_reason == "abuse"
        rows = await _audit_rows(db, "org.suspend")
        assert len(rows) == 1


async def test_suspend_404_unknown_org():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{uuid.uuid4()}/suspend",
                          json={"reason": "abuse"},
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 404


# -------------------------------------------------------------- unsuspend ---

async def test_unsuspend_clears_state_and_audits():
    async with await _client() as ac:
        headers = {"Authorization": f"Bearer {_super_bearer()}"}
        r1 = await ac.post(f"/api/v1/admin/orgs/{ORG_ACME}/suspend",
                           json={"reason": "abuse"}, headers=headers)
        assert r1.status_code == 200

        r2 = await ac.post(f"/api/v1/admin/orgs/{ORG_ACME}/unsuspend", headers=headers)
        assert r2.status_code == 200

    async with Session() as db:
        org = await _get_org(db, ORG_ACME)
        assert org.suspended_at is None
        assert org.suspended_reason is None

        rows = await _audit_rows(db, "org.unsuspend")
        assert len(rows) == 1
        assert rows[0].before_json == {"suspended": True, "reason": "abuse"}
        assert rows[0].after_json == {"suspended": False}


async def test_unsuspend_forbidden_for_auditor():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{ORG_ACME}/unsuspend",
                          headers={"Authorization": f"Bearer {_auditor_bearer()}"})
        assert r.status_code == 403


async def test_unsuspend_404_unknown_org():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{uuid.uuid4()}/unsuspend",
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 404


# ------------------------------------------------------------ reset-quotas ---

async def test_reset_quotas_zeroes_all_periods_and_audits_prior_sum():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{ORG_ACME}/reset-quotas",
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 200

    async with Session() as db:
        usage_rows = (await db.execute(
            select(OrgUsage).where(OrgUsage.org_id == ORG_ACME)
        )).scalars().all()
        assert len(usage_rows) == 2
        for row in usage_rows:
            assert row.ai_input_tokens == 0
            assert row.ai_output_tokens == 0
            assert row.ai_requests == 0
            assert row.seo_serp == 0
            assert row.seo_keyword_analyses == 0
            assert row.cost_micros == 0

        rows = await _audit_rows(db, "org.reset_quotas")
        assert len(rows) == 1
        assert rows[0].before_json == {
            "ai_input_tokens": 3000,
            "ai_output_tokens": 1250,
            "ai_requests": 150,
            "seo_serp": 15,
            "seo_keyword_analyses": 6,
            "cost_micros": 750_000,
        }
        assert rows[0].after_json == {
            "ai_input_tokens": 0,
            "ai_output_tokens": 0,
            "ai_requests": 0,
            "seo_serp": 0,
            "seo_keyword_analyses": 0,
            "cost_micros": 0,
        }


async def test_reset_quotas_forbidden_for_auditor_no_state_change():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{ORG_ACME}/reset-quotas",
                          headers={"Authorization": f"Bearer {_auditor_bearer()}"})
        assert r.status_code == 403

    async with Session() as db:
        usage_rows = (await db.execute(
            select(OrgUsage).where(OrgUsage.org_id == ORG_ACME)
        )).scalars().all()
        assert any(row.ai_requests != 0 for row in usage_rows)
        rows = await _audit_rows(db, "org.reset_quotas")
        assert len(rows) == 0


async def test_reset_quotas_404_unknown_org():
    async with await _client() as ac:
        r = await ac.post(f"/api/v1/admin/orgs/{uuid.uuid4()}/reset-quotas",
                          headers={"Authorization": f"Bearer {_super_bearer()}"})
        assert r.status_code == 404
