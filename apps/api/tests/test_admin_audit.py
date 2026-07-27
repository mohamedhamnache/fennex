import uuid, pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.core.database import Base
from app.models.admin_audit_log import AdminAuditLog
from app.services.admin.audit import record_admin_action

engine = create_async_engine("sqlite+aiosqlite:///:memory:")
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)

async def test_record_admin_action_writes_row():
    actor = uuid.uuid4(); org = uuid.uuid4()
    async with Session() as db:
        await record_admin_action(db, actor_admin_id=actor, action="org.suspend",
                                  resource_type="organization", resource_id=str(org),
                                  before={"suspended": False}, after={"suspended": True},
                                  ip="10.0.0.1")
        await db.commit()
        row = (await db.execute(select(AdminAuditLog))).scalar_one()
        assert row.action == "org.suspend" and row.resource_id == str(org)
        assert row.before_json == {"suspended": False} and row.after_json == {"suspended": True}
        assert row.ip == "10.0.0.1" and row.result == "ok"
