import uuid
from typing import Optional

import arq
from fastapi import APIRouter, HTTPException, status, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.keyword import KeywordResearchJob, Keyword, KeywordCluster, ResearchStatus, KeywordIntent
from app.models.project import Project

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class ResearchRequest(BaseModel):
    project_id: uuid.UUID
    seed_keyword: str


class ResearchJobResponse(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    project_id: uuid.UUID
    seed_keyword: str
    status: str
    keywords_found: int
    error: Optional[str]

    class Config:
        from_attributes = True


class KeywordResponse(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    org_id: uuid.UUID
    project_id: uuid.UUID
    keyword: str
    search_volume: Optional[int]
    difficulty: Optional[float]
    cpc: Optional[float]
    intent: Optional[str]
    cluster_id: Optional[uuid.UUID]
    is_seed: bool
    serp_features: Optional[list]

    class Config:
        from_attributes = True


class ClusterResponse(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    org_id: uuid.UUID
    name: str
    topic: Optional[str]
    total_volume: int
    keyword_count: int

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/research", status_code=202)
async def trigger_keyword_research(
    body: ResearchRequest,
    current_user: CurrentUser,
    db: DB,
):
    proj_result = await db.execute(
        select(Project).where(Project.id == body.project_id, Project.org_id == current_user.org_id)
    )
    if proj_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Project not found")

    job = KeywordResearchJob(
        org_id=current_user.org_id,
        project_id=body.project_id,
        seed_keyword=body.seed_keyword,
        status=ResearchStatus.pending,
    )
    db.add(job)
    await db.flush()
    await db.refresh(job)

    job_id_str = str(job.id)

    await db.commit()

    redis_pool = await arq.create_pool(settings.REDIS_SETTINGS)
    try:
        await redis_pool.enqueue_job("run_keyword_research", job_id_str)
    finally:
        await redis_pool.aclose()

    return {"job_id": job_id_str, "status": ResearchStatus.pending.value}


@router.get("/research/{job_id}", response_model=ResearchJobResponse)
async def get_research_job(
    job_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(KeywordResearchJob).where(
            KeywordResearchJob.id == job_id,
            KeywordResearchJob.org_id == current_user.org_id,
        )
    )
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research job not found")
    return job


@router.get("/research/{job_id}/keywords")
async def list_job_keywords(
    job_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    # Verify job belongs to org
    job_result = await db.execute(
        select(KeywordResearchJob).where(
            KeywordResearchJob.id == job_id,
            KeywordResearchJob.org_id == current_user.org_id,
        )
    )
    if job_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research job not found")

    result = await db.execute(
        select(Keyword)
        .where(Keyword.job_id == job_id)
        .order_by(Keyword.search_volume.desc().nullslast())
        .offset(offset)
        .limit(limit)
    )
    keywords = result.scalars().all()
    return {"keywords": [KeywordResponse.model_validate(kw) for kw in keywords]}


@router.get("/research/{job_id}/clusters")
async def list_job_clusters(
    job_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    # Verify job belongs to org
    job_result = await db.execute(
        select(KeywordResearchJob).where(
            KeywordResearchJob.id == job_id,
            KeywordResearchJob.org_id == current_user.org_id,
        )
    )
    if job_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Research job not found")

    result = await db.execute(
        select(KeywordCluster)
        .where(KeywordCluster.job_id == job_id)
        .order_by(KeywordCluster.total_volume.desc())
    )
    clusters = result.scalars().all()
    return {"clusters": [ClusterResponse.model_validate(c) for c in clusters]}


@router.get("")
async def list_keywords(
    current_user: CurrentUser,
    db: DB,
    project_id: uuid.UUID = Query(...),
):
    # Verify project belongs to org
    proj_result = await db.execute(
        select(Project).where(Project.id == project_id, Project.org_id == current_user.org_id)
    )
    if proj_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    # Get last completed research job for this project
    job_result = await db.execute(
        select(KeywordResearchJob)
        .where(
            KeywordResearchJob.project_id == project_id,
            KeywordResearchJob.org_id == current_user.org_id,
            KeywordResearchJob.status == ResearchStatus.completed,
        )
        .order_by(KeywordResearchJob.created_at.desc())
        .limit(1)
    )
    job = job_result.scalar_one_or_none()
    if job is None:
        return {"keywords": []}

    result = await db.execute(
        select(Keyword)
        .where(Keyword.job_id == job.id)
        .order_by(Keyword.search_volume.desc().nullslast())
        .limit(200)
    )
    keywords = result.scalars().all()
    return {"keywords": [KeywordResponse.model_validate(kw) for kw in keywords]}
