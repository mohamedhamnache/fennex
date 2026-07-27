import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
import pytest
from app.core.database import Base
from app.models.admin_user import AdminUser, AdminRole, AdminRoleAssignment

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)

async def test_admin_user_role_assignment_roundtrip():
    async with Session() as db:
        role = AdminRole(key="support", name="Support", description="")
        admin = AdminUser(email="ops@fennex.io", name="Ops", password_hash="x", is_active=True)
        db.add_all([role, admin])
        await db.flush()
        db.add(AdminRoleAssignment(admin_user_id=admin.id, role_id=role.id))
        await db.commit()
        got = (await db.execute(select(AdminUser).where(AdminUser.email == "ops@fennex.io"))).scalar_one()
        assert got.is_active is True
        assignments = (await db.execute(select(AdminRoleAssignment))).scalars().all()
        assert len(assignments) == 1 and assignments[0].role_id == role.id
