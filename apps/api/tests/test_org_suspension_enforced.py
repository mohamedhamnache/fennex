"""Enforcement test: a suspended organization must block customer auth.

Mirrors the in-memory sqlite pattern used by test_admin_auth_router.py, but for
the CUSTOMER auth path (app.core.dependencies.get_current_user). Unlike
test_users_language.py, this test does NOT override get_current_user — it
mints a real JWT via create_access_token and lets the real dependency run,
so it actually exercises the suspension check.
"""
import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base, get_db
from app.core.security import create_access_token
from app.main import app
from app.models.organization import Organization, PlanTier
from app.models.user import User, UserRole

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)

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


async def _seed_org_and_user(*, suspended: bool) -> User:
    org_id = uuid.uuid4()
    user_id = uuid.uuid4()
    async with Session() as db:
        org = Organization(
            id=org_id,
            slug=f"org-{org_id.hex[:8]}",
            name="Test Org",
            plan_tier=PlanTier.FREE,
            suspended_at=datetime.now(timezone.utc) if suspended else None,
            suspended_reason="ToS violation" if suspended else None,
        )
        user = User(
            id=user_id,
            org_id=org_id,
            email=f"user-{user_id.hex[:8]}@test.com",
            hashed_password="x",
            full_name="Test User",
            role=UserRole.OWNER,
            is_active=True,
            language="en",
        )
        db.add_all([org, user])
        await db.commit()
    return user


async def test_suspended_org_blocks_customer_auth():
    user = await _seed_org_and_user(suspended=True)
    token = create_access_token({"sub": str(user.id), "org_id": str(user.org_id), "role": user.role.value})
    async with await _client() as ac:
        resp = await ac.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403


async def test_non_suspended_org_allows_customer_auth():
    user = await _seed_org_and_user(suspended=False)
    token = create_access_token({"sub": str(user.id), "org_id": str(user.org_id), "role": user.role.value})
    async with await _client() as ac:
        resp = await ac.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
