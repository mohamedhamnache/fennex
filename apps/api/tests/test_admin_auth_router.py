import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base, get_db
from app.core.security import pwd_context
from app.main import app
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with Session() as db:
        role = AdminRole(key="super_admin", name="Super Admin", description="")
        admin = AdminUser(email="owner@fennex.io", name="Owner",
                          password_hash=pwd_context.hash("secret"), is_active=True)
        db.add_all([role, admin]); await db.flush()
        db.add(AdminRoleAssignment(admin_user_id=admin.id, role_id=role.id)); await db.commit()
    async def _override():
        async with Session() as s: yield s
    app.dependency_overrides[get_db] = _override
    yield
    app.dependency_overrides.clear()
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)

async def _client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://t")

async def test_login_ok_and_me():
    async with await _client() as ac:
        r = await ac.post("/api/v1/admin/auth/login",
                          data={"username": "owner@fennex.io", "password": "secret"})
        assert r.status_code == 200
        tok = r.json()["access_token"]
        me = await ac.get("/api/v1/admin/me", headers={"Authorization": f"Bearer {tok}"})
        assert me.status_code == 200
        body = me.json()
        assert body["email"] == "owner@fennex.io" and "super_admin" in body["roles"]
        assert "org.suspend" in body["permissions"]

async def test_login_wrong_password_401():
    async with await _client() as ac:
        r = await ac.post("/api/v1/admin/auth/login",
                          data={"username": "owner@fennex.io", "password": "nope"})
        assert r.status_code == 401

async def test_me_without_token_401():
    async with await _client() as ac:
        assert (await ac.get("/api/v1/admin/me")).status_code == 401

async def test_me_with_non_uuid_sub_401():
    # A validly-signed admin-scope token whose `sub` is not a UUID must 401,
    # never 500 (regression guard for the uuid parse).
    from app.core.admin_auth import create_admin_token
    tok = create_admin_token("not-a-uuid", ["auditor"])
    async with await _client() as ac:
        r = await ac.get("/api/v1/admin/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401
