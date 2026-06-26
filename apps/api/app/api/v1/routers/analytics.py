"""Analytics endpoints — traffic, rankings, GSC connection."""
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Query
from sqlalchemy import delete

from app.core.dependencies import CurrentUser, DB
from app.models.analytics import GscConnection
from app.schemas.analytics import (
    AnalyticsOverview,
    ContentPerformanceRow,
    GscConnectResponse,
    GscConnectionStatus,
    RankingRow,
    TopPageRow,
    TopQueryRow,
    TrafficDataPoint,
)
from app.services.analytics_service import (
    get_content_performance,
    get_gsc_status,
    get_overview,
    get_rankings,
    get_top_pages,
    get_top_queries,
    get_traffic,
)

router = APIRouter()

RangeParam = Query(default="28d", pattern="^(7d|28d|90d)$")
SortParam = Query(default="position", pattern="^(position|volume|change)$")


@router.get("/overview", response_model=AnalyticsOverview)
async def analytics_overview(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    range: str = RangeParam,
):
    return await get_overview(project_id, current_user.org_id, range, db)


@router.get("/traffic", response_model=list[TrafficDataPoint])
async def analytics_traffic(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    range: str = RangeParam,
):
    return await get_traffic(project_id, current_user.org_id, range, db)


@router.get("/rankings", response_model=list[RankingRow])
async def analytics_rankings(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    sort_by: str = SortParam,
    page: int = Query(default=1, ge=1),
):
    return await get_rankings(project_id, current_user.org_id, db, sort_by, page)


@router.get("/top-pages", response_model=list[TopPageRow])
async def analytics_top_pages(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    return await get_top_pages(project_id, current_user.org_id, db)


@router.get("/top-queries", response_model=list[TopQueryRow])
async def analytics_top_queries(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    return await get_top_queries(project_id, current_user.org_id, db)


@router.get("/content-performance", response_model=list[ContentPerformanceRow])
async def analytics_content_performance(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    return await get_content_performance(project_id, current_user.org_id, db)


@router.get("/gsc/status", response_model=GscConnectionStatus)
async def gsc_status(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    return await get_gsc_status(project_id, current_user.org_id, db)


@router.post("/gsc/connect", response_model=GscConnectResponse)
async def gsc_connect(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    # OAuth scaffold — returns a placeholder redirect URL.
    # Replace with real Google OAuth2 flow when credentials are configured.
    redirect_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id=CONFIGURE_IN_ENV"
        f"&redirect_uri=CONFIGURE_IN_ENV"
        f"&response_type=code"
        f"&scope=https://www.googleapis.com/auth/webmasters.readonly"
        f"&state={project_id}"
        f"&access_type=offline"
    )
    return GscConnectResponse(redirect_url=redirect_url)


@router.delete("/gsc/disconnect", status_code=204)
async def gsc_disconnect(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    await db.execute(
        delete(GscConnection).where(
            GscConnection.project_id == project_id,
            GscConnection.org_id == current_user.org_id,
        )
    )
    await db.commit()
