"""Product-to-3D: enqueue + status endpoints.

Kept in its own router rather than folded into product.py (product scenes)
per the design spec's separation between the "Product Showcase" and "Product
to 3D" tools -- registered under the same /product prefix so the paths still
read /product/to-3d.

The endpoint here only validates the request and persists a `pending` row.
Execution (Trellis generation + GLB/OBJ conversion via
app/services/product3d/convert.py, run on an arq worker) is out of scope for
this task and lands separately.
"""
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import select

from app.core.billing import require_credits
from app.core.dependencies import CurrentUser, DB
from app.models.product3d import Product3DJob, Product3DStatus, ModelFormat
from app.models.project import Project
from app.services.prompting.vocab import QualityToken, TextureResolutionToken

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class Product3DRequest(BaseModel):
    project_id: uuid.UUID
    source_image_url: str
    quality: QualityToken = "high"
    texture_resolution: TextureResolutionToken = "2K"
    # A bare list[ModelFormat] already rejects any value outside {glb, obj}
    # with a 422 at the schema boundary -- ModelFormat has no other members.
    formats: list[ModelFormat]

    @field_validator("formats")
    @classmethod
    def _at_least_one_format(cls, v: list[ModelFormat]) -> list[ModelFormat]:
        if not v:
            raise ValueError("formats must include at least one of: glb, obj")
        return v


class Product3DEnqueueOut(BaseModel):
    job_id: uuid.UUID
    status: Product3DStatus


class Product3DStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    job_id: uuid.UUID
    status: Product3DStatus
    quality: str
    texture_resolution: str
    formats: list[str]
    output_urls: dict[str, str]
    error: str | None

    @classmethod
    def from_job(cls, job: Product3DJob) -> "Product3DStatusOut":
        return cls(
            job_id=job.id,
            status=job.status,
            quality=job.quality,
            texture_resolution=job.texture_resolution,
            formats=job.requested_formats,
            output_urls=job.output_urls,
            error=job.error,
        )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/to-3d", response_model=Product3DEnqueueOut, status_code=status.HTTP_202_ACCEPTED)
async def enqueue_product_to_3d(
    body: Product3DRequest,
    current_user: CurrentUser,
    db: DB,
    _: Annotated[None, Depends(require_credits("ai"))],
):
    proj_result = await db.execute(
        select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id)
    )
    if proj_result.scalar_one_or_none() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")

    job = Product3DJob(
        org_id=current_user.org_id,
        project_id=body.project_id,
        source_image_url=body.source_image_url,
        status=Product3DStatus.pending,
        quality=body.quality,
        texture_resolution=body.texture_resolution,
        requested_formats=[f.value for f in body.formats],
        output_urls={},
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)
    job_id = job.id
    job_status = job.status
    await db.commit()

    return Product3DEnqueueOut(job_id=job_id, status=job_status)


@router.get("/to-3d/{job_id}", response_model=Product3DStatusOut)
async def get_product_to_3d_status(
    job_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(Product3DJob).where(Product3DJob.id == job_id, Product3DJob.org_id == current_user.org_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Product-to-3D job not found")

    return Product3DStatusOut.from_job(job)
