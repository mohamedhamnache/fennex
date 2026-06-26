import uuid

import arq
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.crawl import CrawlJob, CrawlStatus, CrawledPage

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class CrawlRequest(BaseModel):
    project_id: uuid.UUID
    url: str


class CrawlJobResponse(BaseModel):
    job_id: str
    status: str
    pages_crawled: int = 0
    pages_total: int | None = None
    error: str | None = None

    class Config:
        from_attributes = True


class CrawledPageResponse(BaseModel):
    id: uuid.UUID
    url: str
    status_code: int | None
    seo_score: float | None

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", status_code=202)
async def trigger_crawl(
    body: CrawlRequest,
    current_user: CurrentUser,
    db: DB,
):
    job = CrawlJob(
        org_id=current_user.org_id,
        project_id=body.project_id,
        status=CrawlStatus.pending,
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)

    job_id_str = str(job.id)

    redis_pool = await arq.create_pool(settings.REDIS_SETTINGS)
    try:
        await redis_pool.enqueue_job("crawl_website", job_id_str, body.url)
    finally:
        await redis_pool.aclose()

    return {"job_id": job_id_str, "status": CrawlStatus.pending.value}


@router.get("/{crawl_id}", response_model=CrawlJobResponse)
async def get_crawl_status(
    crawl_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(CrawlJob).where(CrawlJob.id == crawl_id, CrawlJob.org_id == current_user.org_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Crawl job not found")

    return CrawlJobResponse(
        job_id=str(job.id),
        status=job.status.value,
        pages_crawled=job.pages_crawled,
        pages_total=job.pages_total,
        error=job.error,
    )


@router.get("/{crawl_id}/pages", response_model=list[CrawledPageResponse])
async def list_crawled_pages(
    crawl_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    skip: int = 0,
    limit: int = 50,
):
    # Verify the job belongs to this org
    result = await db.execute(
        select(CrawlJob).where(CrawlJob.id == crawl_id, CrawlJob.org_id == current_user.org_id)
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Crawl job not found")

    pages_result = await db.execute(
        select(CrawledPage)
        .where(CrawledPage.crawl_job_id == crawl_id)
        .offset(skip)
        .limit(limit)
    )
    return pages_result.scalars().all()
