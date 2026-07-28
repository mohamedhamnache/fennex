"""arq worker: run Trellis for a Product3DJob, convert to each requested
format, upload each, and record status (design spec section 3).

Trellis (`generate_glb`) is called exactly once regardless of how many
formats were requested -- GLB is its native output; every other format is a
local conversion of those same bytes (`app/services/product3d/convert.py`).

Per-format conversion+upload is isolated: a failure converting or uploading
one requested format is logged and skipped, never lets one bad format fail
formats that did work. This mirrors `Product3DJob.output_urls`'s own
docstring: "a format present in requested_formats but absent here failed
independently -- the whole job is not failed just because one conversion
did." Only if *every* requested format fails is the job itself marked
failed (nothing was actually delivered, so a silent empty "completed" would
be misleading).
"""
import logging
import uuid

from app.core.database import async_session_factory
from app.core.metering_context import set_metering_org
from app.core.storage import upload_bytes
from app.models.product3d import ModelFormat, Product3DJob, Product3DStatus
from app.services.product3d.convert import convert
from app.services.product3d.generate import generate_glb

logger = logging.getLogger(__name__)

# Content type + stored-object suffix per format. OBJ is multi-file (.obj +
# .mtl + textures), so it is stored as a zip -- never named ".obj" on its
# own, per the design spec and convert.py's own docstring.
_CONTENT_TYPES = {
    ModelFormat.glb: "model/gltf-binary",
    ModelFormat.obj: "application/zip",
}
_STORAGE_SUFFIXES = {
    ModelFormat.glb: "glb",
    ModelFormat.obj: "obj.zip",
}


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
        requested_formats = list(job.requested_formats)
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

        output_urls: dict[str, str] = {}
        for raw_format in requested_formats:
            fmt = ModelFormat(raw_format)
            try:
                converted_bytes = await convert(glb_bytes, fmt)
                key = f"product3d/{job_id}.{_STORAGE_SUFFIXES[fmt]}"
                url = await upload_bytes(converted_bytes, key, _CONTENT_TYPES[fmt])
                output_urls[fmt.value] = url
            except Exception:
                # Per-format isolation (design spec section 3): a failure
                # converting or uploading ONE requested format must not
                # take down formats that succeeded. Logged, not raised --
                # see the module docstring.
                logger.warning(
                    "product3d job %s: format %r failed to convert/upload",
                    job_id, fmt.value, exc_info=True,
                )

        async with async_session_factory() as session:
            job_row = await session.get(Product3DJob, uuid.UUID(job_id))
            if job_row:
                job_row.output_urls = {**job_row.output_urls, **output_urls}
                if output_urls:
                    job_row.status = Product3DStatus.completed
                else:
                    # Every requested format failed -- nothing was actually
                    # delivered, so this is a real failure, not a silent
                    # empty "completed".
                    job_row.status = Product3DStatus.failed
                    job_row.error = (
                        f"all requested formats failed to convert/upload: {requested_formats}"
                    )
                await session.commit()

    except Exception as e:
        async with async_session_factory() as session:
            job_row = await session.get(Product3DJob, uuid.UUID(job_id))
            if job_row:
                job_row.status = Product3DStatus.failed
                job_row.error = str(e)
                await session.commit()
        raise
