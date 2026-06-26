import uuid
from typing import Optional

import arq
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.crawl import SEOAudit, AuditStatus

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class AuditRequest(BaseModel):
    project_id: uuid.UUID
    crawl_job_id: Optional[uuid.UUID] = None


class AuditResponse(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    project_id: uuid.UUID
    crawl_job_id: Optional[uuid.UUID]
    status: str
    overall_score: Optional[float]
    technical_score: Optional[float]
    content_score: Optional[float]
    onpage_score: Optional[float]
    issues: Optional[list]
    summary: Optional[dict]

    class Config:
        from_attributes = True


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", status_code=202)
async def trigger_audit(
    body: AuditRequest,
    current_user: CurrentUser,
    db: DB,
):
    audit = SEOAudit(
        org_id=current_user.org_id,
        project_id=body.project_id,
        crawl_job_id=body.crawl_job_id,
        status=AuditStatus.pending,
    )
    db.add(audit)
    await db.flush()
    await db.refresh(audit)

    audit_id_str = str(audit.id)

    redis_pool = await arq.create_pool(settings.REDIS_SETTINGS)
    try:
        await redis_pool.enqueue_job("run_seo_audit", audit_id_str)
    finally:
        await redis_pool.aclose()

    return {"audit_id": audit_id_str, "status": AuditStatus.pending.value}


@router.get("/{audit_id}", response_model=AuditResponse)
async def get_audit(
    audit_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(SEOAudit).where(SEOAudit.id == audit_id, SEOAudit.org_id == current_user.org_id)
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")
    return audit


@router.get("/{audit_id}/issues")
async def list_audit_issues(
    audit_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(SEOAudit).where(SEOAudit.id == audit_id, SEOAudit.org_id == current_user.org_id)
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")
    return {"issues": audit.issues or []}


@router.get("/{audit_id}/summary")
async def get_audit_summary(
    audit_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(SEOAudit).where(SEOAudit.id == audit_id, SEOAudit.org_id == current_user.org_id)
    )
    audit = result.scalar_one_or_none()
    if audit is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Audit not found")
    return {"summary": audit.summary or {}}
