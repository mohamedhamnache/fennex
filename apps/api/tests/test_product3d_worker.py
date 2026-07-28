"""Worker task tests for run_product_3d.

Strategy mirrors tests/test_backlink_tasks.py: in-memory SQLite via
Base.metadata.create_all (no migration needs to be applied),
async_session_factory patched inside the task module, and the ONE external
call the task makes -- editing_service._replicate_run, as imported into
app.services.product3d.generate -- stubbed so there is NO network traffic
(no HTTP create/poll against Replicate).

_replicate_run's real implementation does two things on success: return the
output URL, and (best-effort, via the ambient app.core.metering_context
contextvar) call app.services.metering.meter.record_replicate -- that inline
call IS the "meters every prediction" behaviour the task-5 brief says this
worker inherits "for free" by reusing the chokepoint. A bare AsyncMock stub
would skip that call entirely and make it impossible to prove metering is
inherited rather than silently missing, so `_stub_replicate_run` below is a
faithful behavioural double: same return contract, same metering side effect
(via TestSessionLocal, not the real DB), zero network and zero HTTP polling.
On failure a bare raising AsyncMock is a fully faithful stub either way,
because the real function's metering call sits inside its "succeeded" branch
-- an exception before that point never reaches it, in the real
implementation or the stub.
"""
import base64
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.billing import OrgUsage
from app.models.cost_rate import CostRate
from app.models.organization import Organization
from app.models.product3d import Product3DJob, Product3DStatus
from app.models.project import Project
from app.models.usage_event import UsageEvent
from app.workers.tasks.product3d_tasks import run_product_3d

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)

_FAKE_GLB_BYTES = b"glTF-fake-binary-payload"
_FAKE_REPLICATE_OUTPUT_URL = (
    "data:model/gltf-binary;base64," + base64.b64encode(_FAKE_GLB_BYTES).decode("ascii")
)


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _stub_replicate_run(model, input_params, version=None):
    from app.core.metering_context import get_metering_org
    org = get_metering_org()
    if org is not None:
        from app.services.metering import meter as _meter
        async with TestSessionLocal() as _db:
            await _meter.record_replicate(_db, org_id=org, project_id=None, model=model, feature="image_edit")
    return _FAKE_REPLICATE_OUTPUT_URL


async def _make_job(formats=("glb", "obj")) -> tuple[uuid.UUID, uuid.UUID]:
    org_id = uuid.uuid4()
    project_id = uuid.uuid4()
    async with TestSessionLocal() as session:
        session.add(Organization(id=org_id, slug=f"org-{org_id.hex[:8]}", name="PAS3D Org"))
        session.add(Project(id=project_id, org_id=org_id, name="PAS3D Project", domain="pas3d.example"))
        job = Product3DJob(
            org_id=org_id,
            project_id=project_id,
            source_image_url="https://cdn.fennex.ai/products/sneaker.png",
            status=Product3DStatus.pending,
            quality="high",
            texture_resolution="2K",
            requested_formats=list(formats),
            output_urls={},
        )
        session.add(job)
        await session.commit()
        job_id = job.id
    return org_id, job_id


async def test_run_product_3d_success_marks_completed_and_stores_glb_url():
    org_id, job_id = await _make_job()

    mock_replicate = AsyncMock(side_effect=_stub_replicate_run)
    with patch("app.services.product3d.generate._replicate_run", mock_replicate), \
         patch("app.workers.tasks.product3d_tasks.async_session_factory", TestSessionLocal):
        await run_product_3d(ctx={}, job_id=str(job_id))

    async with TestSessionLocal() as session:
        job = await session.get(Product3DJob, job_id)
        assert job.status == Product3DStatus.completed
        assert job.error is None
        assert "glb" in job.output_urls
        assert job.output_urls["glb"].startswith("data:model/gltf-binary;base64,")
        decoded = base64.b64decode(job.output_urls["glb"].split(",", 1)[1])
        assert decoded == _FAKE_GLB_BYTES

    mock_replicate.assert_awaited_once()


async def test_run_product_3d_failure_marks_failed_and_bills_nothing():
    org_id, job_id = await _make_job()

    mock_replicate = AsyncMock(side_effect=RuntimeError("trellis prediction failed"))
    with patch("app.services.product3d.generate._replicate_run", mock_replicate), \
         patch("app.workers.tasks.product3d_tasks.async_session_factory", TestSessionLocal):
        with pytest.raises(RuntimeError):
            await run_product_3d(ctx={}, job_id=str(job_id))

    async with TestSessionLocal() as session:
        job = await session.get(Product3DJob, job_id)
        assert job.status == Product3DStatus.failed
        assert job.error == "trellis prediction failed"
        assert job.output_urls == {}

        ev_result = await session.execute(select(UsageEvent).where(UsageEvent.org_id == org_id))
        assert ev_result.scalars().all() == []

        ou_result = await session.execute(select(OrgUsage).where(OrgUsage.org_id == org_id))
        ou = ou_result.scalar_one_or_none()
        assert ou is None or ou.ai_credits_used == 0

    mock_replicate.assert_awaited_once()


async def test_run_product_3d_meters_exactly_one_replicate_call_regardless_of_formats():
    """requested_formats has two entries (glb, obj) but Trellis is only ever
    invoked once -- OBJ is a local conversion of the same GLB bytes (a
    separate, not-yet-landed piece), never a second supplier call."""
    org_id, job_id = await _make_job(formats=("glb", "obj"))

    mock_replicate = AsyncMock(side_effect=_stub_replicate_run)
    with patch("app.services.product3d.generate._replicate_run", mock_replicate), \
         patch("app.workers.tasks.product3d_tasks.async_session_factory", TestSessionLocal):
        await run_product_3d(ctx={}, job_id=str(job_id))

    assert mock_replicate.await_count == 1

    async with TestSessionLocal() as session:
        ev_result = await session.execute(select(UsageEvent).where(UsageEvent.org_id == org_id))
        events = ev_result.scalars().all()
        assert len(events) == 1
        assert events[0].kind == "edit"
        assert events[0].provider == "replicate"
        assert events[0].model == "firtoz/trellis"


async def test_run_product_3d_success_meters_replicate_floor_credits():
    """With a seeded cost_rates row, a successful run bills the Replicate
    10-credit floor (app.core.credits.replicate_operation_credits) into
    OrgUsage.ai_credits_used -- proof that _replicate_run's own metering
    (usage_events + ai_cost_micros + ai_credits_used) is inherited, not
    reimplemented, by this worker."""
    org_id, job_id = await _make_job()

    async with TestSessionLocal() as session:
        session.add(CostRate(provider="replicate", unit="run", model="firtoz/trellis",
                             micro_dollars_per_unit=100_000))
        await session.commit()

    mock_replicate = AsyncMock(side_effect=_stub_replicate_run)
    with patch("app.services.product3d.generate._replicate_run", mock_replicate), \
         patch("app.workers.tasks.product3d_tasks.async_session_factory", TestSessionLocal):
        await run_product_3d(ctx={}, job_id=str(job_id))

    async with TestSessionLocal() as session:
        ou = (await session.execute(
            select(OrgUsage).where(OrgUsage.org_id == org_id)
        )).scalar_one()
        assert ou.ai_credits_used >= 10  # MIN_REPLICATE_CREDITS floor
        assert ou.ai_cost_micros == 100_000
