"""Backlinks router — monitor + exchange marketplace."""
import uuid
from typing import Optional

import arq
from fastapi import APIRouter, HTTPException, Query

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.schemas.backlinks import (
    AnalyzeResponse,
    BacklinkOpportunityOut,
    BacklinkOut,
    BacklinkProfileOut,
    OpportunityStatusUpdate,
)
from app.services.backlinks_service import (
    get_profile,
    list_backlinks,
    list_opportunities,
    update_opportunity_status,
)

router = APIRouter()


# ── Monitor ──────────────────────────────────────────────────────────────────

@router.get("/profile", response_model=BacklinkProfileOut)
async def backlink_profile(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    profile = await get_profile(project_id, current_user.org_id, db)
    if not profile:
        raise HTTPException(status_code=404, detail="No backlink profile yet. Run Analyze first.")
    return profile


@router.post("/analyze", response_model=AnalyzeResponse, status_code=202)
async def analyze_backlinks(
    project_id: uuid.UUID,
    current_user: CurrentUser,
):
    redis = await arq.create_pool(settings.REDIS_SETTINGS)
    job = await redis.enqueue_job("sync_backlink_profile", str(project_id))
    await redis.aclose()
    return AnalyzeResponse(job_id=job.job_id if job else "queued", status="queued")


@router.get("", response_model=list[BacklinkOut])
async def list_backlinks_endpoint(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    is_spam: Optional[bool] = Query(default=None),
    page: int = Query(default=1, ge=1),
):
    return await list_backlinks(project_id, current_user.org_id, is_spam, page, db)


@router.get("/opportunities", response_model=list[BacklinkOpportunityOut])
async def list_opportunities_endpoint(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    status: Optional[str] = Query(default=None),
):
    return await list_opportunities(project_id, current_user.org_id, status, db)


@router.patch("/opportunities/{opportunity_id}", response_model=BacklinkOpportunityOut)
async def update_opportunity(
    opportunity_id: uuid.UUID,
    body: OpportunityStatusUpdate,
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    opp = await update_opportunity_status(opportunity_id, project_id, current_user.org_id, body.status, db)
    if not opp:
        raise HTTPException(status_code=404, detail="Opportunity not found")
    return opp


# ── Exchange (implemented in Phase 11c) ─────────────────────────────────────

@router.get("/exchange/board")
async def exchange_board():
    return []

@router.get("/exchange/listing")
async def get_listing():
    raise HTTPException(status_code=404, detail="No listing")

@router.post("/exchange/listing", status_code=201)
async def create_listing():
    return {"message": "Not implemented yet"}

@router.delete("/exchange/listing", status_code=204)
async def delete_listing():
    pass

@router.get("/exchange/requests")
async def list_requests():
    return []

@router.post("/exchange/requests", status_code=201)
async def create_request():
    return {"message": "Not implemented yet"}

@router.patch("/exchange/requests/{request_id}")
async def update_request(request_id: uuid.UUID):
    return {"message": "Not implemented yet"}

@router.post("/exchange/requests/{request_id}/verify", status_code=202)
async def verify_request(request_id: uuid.UUID):
    return {"message": "Not implemented yet"}

@router.get("/exchange/requests/{request_id}/messages")
async def list_messages(request_id: uuid.UUID):
    return []

@router.post("/exchange/requests/{request_id}/messages", status_code=201)
async def send_message(request_id: uuid.UUID):
    return {"message": "Not implemented yet"}
