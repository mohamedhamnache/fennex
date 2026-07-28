"""arq worker: run Trellis for a Product3DJob, upload the GLB, record status.

OBJ (and any future format) conversion is a separate, not-yet-landed piece
(design spec section 3, "Format conversion" -- `app/services/product3d/convert.py`).
This task is responsible only for the GLB Trellis itself produces: a job
requesting `["glb", "obj"]` completes with `output_urls == {"glb": ...}`,
which `Product3DJob.output_urls`'s own docstring already treats as a valid
partial-success state ("a format present in requested_formats but absent
here failed independently -- the whole job is not failed just because one
conversion did").
"""
import logging
import uuid

from app.core.database import async_session_factory
from app.core.metering_context import set_metering_org
from app.core.storage import upload_bytes
from app.models.product3d import ModelFormat, Product3DJob, Product3DStatus
from app.services.product3d.generate import generate_glb

logger = logging.getLogger(__name__)


async def run_product_3d(ctx, job_id: str):
    """ARQ task: generate the 3D asset for a Product3DJob and mark it terminal.

    Mirrors run_keyword_research's shape (load -> mark running -> do the
    work -> mark completed, or mark failed and re-raise on any exception).
    """
    async with async_session_factory() as session:
        job = await session.get(Product3DJob, uuid.UUID(job_id))
        if job is None:
            return
        source_image_url = job.source_image_url
        quality = job.quality
        texture_resolution = job.texture_resolution
        org_id = job.org_id
        job.status = Product3DStatus.running
        await session.commit()

    try:
        # No request context in a worker: attribute the Replicate call this
        # job is about to make to its org explicitly, the same way the auth
        # dependency does for HTTP requests (app/core/dependencies.py) and
        # get_org_llm_keys does for LLM calls -- _replicate_run's metering
        # reads this ambient contextvar and no-ops (bills nothing) without it.
        set_metering_org(org_id)

        glb_bytes = await generate_glb(source_image_url, quality, texture_resolution)

        key = f"product3d/{job_id}.glb"
        glb_url = await upload_bytes(glb_bytes, key, "model/gltf-binary")

        async with async_session_factory() as session:
            job_row = await session.get(Product3DJob, uuid.UUID(job_id))
            if job_row:
                job_row.output_urls = {**job_row.output_urls, ModelFormat.glb.value: glb_url}
                job_row.status = Product3DStatus.completed
                await session.commit()

    except Exception as e:
        async with async_session_factory() as session:
            job_row = await session.get(Product3DJob, uuid.UUID(job_id))
            if job_row:
                job_row.status = Product3DStatus.failed
                job_row.error = str(e)
                await session.commit()
        raise
