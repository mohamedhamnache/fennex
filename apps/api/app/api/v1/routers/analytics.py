"""Analytics endpoints — traffic, rankings, GSC connection."""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select

from app.core.config import settings
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
    # Encode project_id and org_id in state so the callback can upsert the right row.
    state = f"{project_id}:{current_user.org_id}"
    scopes = " ".join([
        "https://www.googleapis.com/auth/webmasters.readonly",
        "openid",
        "email",
    ])
    redirect_url = (
        f"https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={settings.GOOGLE_CLIENT_ID}"
        f"&redirect_uri={settings.GOOGLE_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope={scopes}"
        f"&state={state}"
        f"&access_type=offline"
        f"&prompt=consent"
    )
    return GscConnectResponse(redirect_url=redirect_url)


@router.get("/gsc/callback")
async def gsc_callback(
    db: DB,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    """Receive the authorization code from Google and exchange it for tokens."""
    if error or not code or not state:
        return RedirectResponse(f"{settings.FRONTEND_URL}?gsc_error={error or 'missing_params'}")

    try:
        project_id_str, org_id_str = state.split(":", 1)
        project_id = uuid.UUID(project_id_str)
        org_id = uuid.UUID(org_id_str)
    except (ValueError, AttributeError):
        return RedirectResponse(f"{settings.FRONTEND_URL}?gsc_error=invalid_state")

    # Exchange authorization code for access + refresh tokens.
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )

    if token_resp.status_code != 200:
        return RedirectResponse(
            f"{settings.FRONTEND_URL}/{project_id}/analytics?gsc_error=token_exchange_failed"
        )

    token_data = token_resp.json()
    access_token: str = token_data["access_token"]
    refresh_token: Optional[str] = token_data.get("refresh_token")
    expires_in: int = token_data.get("expires_in", 3600)
    token_expiry = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()

    # Fetch the authenticated Google account's email.
    async with httpx.AsyncClient() as client:
        userinfo_resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
    google_email: Optional[str] = None
    if userinfo_resp.status_code == 200:
        google_email = userinfo_resp.json().get("email")

    # Upsert GscConnection — update if exists, insert if not.
    result = await db.execute(
        select(GscConnection).where(GscConnection.project_id == project_id)
    )
    conn = result.scalar_one_or_none()
    if conn:
        conn.google_email = google_email
        conn.access_token = access_token
        if refresh_token:
            conn.refresh_token = refresh_token
        conn.token_expiry = token_expiry
        conn.is_active = True
    else:
        conn = GscConnection(
            project_id=project_id,
            org_id=org_id,
            google_email=google_email,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expiry=token_expiry,
            is_active=True,
        )
        db.add(conn)

    await db.commit()

    return RedirectResponse(f"{settings.FRONTEND_URL}/{project_id}/analytics?gsc_connected=1")


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
