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
    ExchangeListingOut,
    ExchangeListingCreate,
    ExchangeRequestOut,
    ExchangeRequestCreate,
    ExchangeRequestUpdate,
    ExchangeMessageOut,
    ExchangeMessageCreate,
    OpportunityStatusUpdate,
)
from app.services.backlinks_service import (
    get_profile,
    get_exchange_board,
    get_own_listing,
    upsert_listing,
    deactivate_listing,
    list_exchange_requests,
    create_exchange_request,
    update_exchange_request,
    list_messages,
    list_backlinks,
    list_opportunities,
    send_message,
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


# ── Exchange ──────────────────────────────────────────────────────────────────

@router.get("/exchange/board", response_model=list[ExchangeListingOut])
async def exchange_board(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    niche: Optional[str] = Query(default=None),
    language: Optional[str] = Query(default=None),
):
    return await get_exchange_board(niche, language, project_id, db)


@router.get("/exchange/listing", response_model=ExchangeListingOut)
async def get_listing(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    listing = await get_own_listing(project_id, current_user.org_id, db)
    if not listing:
        raise HTTPException(status_code=404, detail="No listing found")
    return listing


@router.post("/exchange/listing", response_model=ExchangeListingOut, status_code=201)
async def create_listing(
    project_id: uuid.UUID,
    body: ExchangeListingCreate,
    current_user: CurrentUser,
    db: DB,
):
    return await upsert_listing(project_id, current_user.org_id, body, db)


@router.delete("/exchange/listing", status_code=204)
async def delete_listing(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await deactivate_listing(project_id, current_user.org_id, db)


@router.get("/exchange/requests", response_model=list[ExchangeRequestOut])
async def list_requests(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    role: Optional[str] = Query(default=None, pattern="^(sent|received)$"),
):
    return await list_exchange_requests(project_id, current_user.org_id, role, db)


@router.post("/exchange/requests", response_model=ExchangeRequestOut, status_code=201)
async def create_request(
    project_id: uuid.UUID,
    body: ExchangeRequestCreate,
    current_user: CurrentUser,
    db: DB,
):
    if body.target_project_id == project_id:
        raise HTTPException(status_code=400, detail="Cannot request exchange with yourself")
    return await create_exchange_request(project_id, current_user.org_id, body, db)


@router.patch("/exchange/requests/{request_id}", response_model=ExchangeRequestOut)
async def update_request(
    request_id: uuid.UUID,
    body: ExchangeRequestUpdate,
    current_user: CurrentUser,
    db: DB,
):
    req = await update_exchange_request(request_id, current_user.org_id, body.status, db)
    if not req:
        raise HTTPException(status_code=404, detail="Request not found")
    return req


@router.post("/exchange/requests/{request_id}/verify", status_code=202)
async def verify_request(
    request_id: uuid.UUID,
    current_user: CurrentUser,
    side: str = Query(pattern="^(requester|target)$"),
):
    redis = await arq.create_pool(settings.REDIS_SETTINGS)
    job = await redis.enqueue_job("verify_exchange_link", str(request_id), side)
    await redis.aclose()
    return {"job_id": job.job_id if job else "queued", "status": "queued"}


@router.get("/exchange/requests/{request_id}/messages", response_model=list[ExchangeMessageOut])
async def get_messages(request_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await list_messages(request_id, current_user.org_id, db)


@router.post("/exchange/requests/{request_id}/messages", response_model=ExchangeMessageOut, status_code=201)
async def post_message(
    request_id: uuid.UUID,
    body: ExchangeMessageCreate,
    current_user: CurrentUser,
    db: DB,
):
    return await send_message(request_id, current_user.org_id, body.body, db)
