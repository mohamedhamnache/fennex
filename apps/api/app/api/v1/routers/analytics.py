"""Analytics endpoints — traffic, rankings, GSC connection."""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.analytics import GscConnection
from app.schemas.analytics import (
    AiAgentRequest,
    AiAgentResponse,
    AnalyticsOverview,
    CompetitorAnalysis,
    CompetitorRequest,
    ContentPerformanceRow,
    GscConnectResponse,
    GscConnectionStatus,
    GscSelectSiteRequest,
    GscSite,
    GscSyncResult,
    HealthScore,
    MarketInsights,
    OpportunitiesResponse,
    PersonaHome,
    PlanGrounding,
    RankingRow,
    TopPageRow,
    TopQueryRow,
    TrafficDataPoint,
)
from app.services import gsc_service
from app.services.analytics_service import (
    get_content_performance,
    get_gsc_status,
    get_health_score,
    get_market_insights,
    get_opportunities,
    get_overview,
    get_rankings,
    get_top_pages,
    get_top_queries,
    get_traffic,
)

router = APIRouter()

RangeParam = Query(default="28d", pattern="^(7d|28d|90d)$")
SortParam = Query(default="clicks", pattern="^(position|clicks|volume|change)$")


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
    offset: int = Query(default=0, ge=0, le=12),
):
    return await get_traffic(project_id, current_user.org_id, range, db, offset)


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


@router.post("/ai-agent", response_model=AiAgentResponse)
async def analytics_ai_agent(
    project_id: uuid.UUID,
    body: AiAgentRequest,
    current_user: CurrentUser,
    db: DB,
):
    from app.services import ai_analytics_service
    result = await ai_analytics_service.answer(
        project_id, current_user.org_id, body.question, db, body.history, body.persona
    )
    return AiAgentResponse(**result)


@router.get("/health-score", response_model=HealthScore)
async def analytics_health_score(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    return await get_health_score(project_id, current_user.org_id, db)


@router.post("/digest/send-now")
async def analytics_digest_send_now(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    """Compose and send this project's weekly digest email immediately."""
    from app.models.project import Project as ProjectModel
    proj = await db.get(ProjectModel, project_id)
    if proj is None or proj.org_id != current_user.org_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    from app.services.digest_service import send_project_digest
    return await send_project_digest(project_id, db)


@router.post("/competitor", response_model=CompetitorAnalysis)
async def analytics_competitor(
    project_id: uuid.UUID,
    body: CompetitorRequest,
    current_user: CurrentUser,
    db: DB,
):
    from app.services import competitor_service
    result = await competitor_service.analyze(project_id, current_user.org_id, body.url, db)
    return CompetitorAnalysis(**result)


@router.get("/market-insights", response_model=MarketInsights)
async def analytics_market_insights(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    return await get_market_insights(project_id, current_user.org_id, db)


@router.post("/market-report")
async def analytics_market_report(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    """Oasis: generate a client-ready market report from this project's GSC data."""
    from app.services.oasis_service import generate_market_report
    return await generate_market_report(project_id, current_user.org_id, db)


@router.post("/icp")
async def analytics_icp(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    """Oasis: define ideal client profile segments for outreach targeting."""
    from app.services.oasis_service import generate_icp
    return await generate_icp(project_id, current_user.org_id, db)


@router.get("/opportunities", response_model=OpportunitiesResponse)
async def analytics_opportunities(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    return await get_opportunities(project_id, current_user.org_id, db)


@router.get("/persona-home", response_model=PersonaHome)
async def analytics_persona_home(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    persona: str = "creator",
):
    from app.services.analytics_service import get_persona_home
    return await get_persona_home(project_id, current_user.org_id, persona, db)


@router.get("/plan-grounding", response_model=PlanGrounding)
async def analytics_plan_grounding(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    from app.services.analytics_service import get_plan_grounding
    return await get_plan_grounding(project_id, current_user.org_id, db)


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


@router.get("/gsc/sites", response_model=list[GscSite])
async def gsc_sites(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """List the Search Console properties the connected account can access."""
    try:
        return await gsc_service.list_sites(project_id, current_user.org_id, db)
    except gsc_service.GscError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


@router.post("/gsc/select-site", response_model=GscConnectionStatus)
async def gsc_select_site(
    project_id: uuid.UUID,
    body: GscSelectSiteRequest,
    current_user: CurrentUser,
    db: DB,
):
    """Pick which GSC property this project tracks."""
    try:
        await gsc_service.select_site(project_id, current_user.org_id, body.site_url, db)
    except gsc_service.GscError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))
    return await get_gsc_status(project_id, current_user.org_id, db)


@router.post("/gsc/sync", response_model=GscSyncResult)
async def gsc_sync(
    project_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    days: int = Query(default=90, ge=7, le=480),
):
    """Pull real Search Analytics data from GSC into the analytics tables."""
    try:
        result = await gsc_service.sync(project_id, current_user.org_id, db, days=days)
        return GscSyncResult(**result)
    except gsc_service.GscError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))


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
