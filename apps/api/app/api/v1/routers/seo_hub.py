"""SERP Intelligence: tracked-keyword CRUD, history, refresh, provider-status, GSC suggestions."""
import uuid

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.project import Project
from app.models.seo_intel import TrackedKeyword
from app.services import analytics_service, rank_tracking_service as rts, serp_service

router = APIRouter()


async def _assert_project(project_id, org_id, db) -> Project:
    proj = (await db.execute(select(Project).where(
        Project.id == project_id, Project.org_id == org_id))).scalars().first()
    if proj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return proj


@router.get("/provider-status")
async def provider_status(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _assert_project(project_id, current_user.org_id, db)
    provider = await serp_service.get_seo_provider_for_org(current_user.org_id, db)
    if provider is None:
        return {"connected": False, "source": None}
    from app.models.api_key import APIKey
    org_key = (await db.execute(select(APIKey).where(
        APIKey.org_id == current_user.org_id, APIKey.provider == "dataforseo"))).scalars().first()
    source = "org" if org_key is not None else ("env" if settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD else None)
    return {"connected": True, "source": source}


@router.get("/keywords")
async def list_keywords(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _assert_project(project_id, current_user.org_id, db)
    return await rts.list_with_stats(project_id, current_user.org_id, db)


class AddKeywordIn(BaseModel):
    project_id: uuid.UUID
    keyword: str


@router.post("/keywords", status_code=status.HTTP_201_CREATED)
async def add_keyword(body: AddKeywordIn, current_user: CurrentUser, db: DB):
    project = await _assert_project(body.project_id, current_user.org_id, db)
    try:
        tk = await rts.add_keyword(project, body.keyword, db)
    except rts.DuplicateKeyword:
        raise HTTPException(status.HTTP_409_CONFLICT, "Keyword already tracked.")
    except rts.CapReached:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Tracking is limited to {rts.TRACKED_CAP} keywords.")
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Keyword required.")
    rows = await rts.list_with_stats(project.id, current_user.org_id, db)
    row = next((r for r in rows if r["id"] == str(tk.id)), None)
    if row is None:
        row = {"id": str(tk.id), "keyword": tk.keyword, "position": None, "url": None,
               "features": [], "last_checked": None, "delta_7d": None, "delta_30d": None, "spark": []}
    return row


@router.delete("/keywords/{keyword_id}")
async def remove_keyword(keyword_id: uuid.UUID, current_user: CurrentUser, db: DB):
    ok = await rts.remove_keyword(keyword_id, current_user.org_id, db)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Keyword not found")
    return {"ok": True}


@router.post("/keywords/{keyword_id}/refresh")
async def refresh_keyword(keyword_id: uuid.UUID, current_user: CurrentUser, db: DB):
    tk = (await db.execute(select(TrackedKeyword).where(
        TrackedKeyword.id == keyword_id, TrackedKeyword.org_id == current_user.org_id))).scalars().first()
    if tk is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Keyword not found")
    project = await _assert_project(tk.project_id, current_user.org_id, db)
    provider = await serp_service.get_seo_provider_for_org(current_user.org_id, db)
    if provider is None:
        raise HTTPException(status.HTTP_409_CONFLICT, {"code": "no_seo_provider"})
    snap = await rts.snapshot_keyword(project, tk, db)
    if snap is None:
        rows = await rts.list_with_stats(project.id, current_user.org_id, db)
        row = next((r for r in rows if r["id"] == str(tk.id)), None)
        return row or {"ok": True}
    return {"id": str(snap.id), "date": snap.date.isoformat(), "position": snap.position,
            "url": snap.url, "top10": snap.top10 or [], "features": snap.features or []}


@router.get("/keywords/{keyword_id}/history")
async def keyword_history(keyword_id: uuid.UUID, current_user: CurrentUser, db: DB, days: int = 90):
    result = await rts.history(keyword_id, current_user.org_id, days, db)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Keyword not found")
    return result


@router.get("/suggestions")
async def keyword_suggestions(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _assert_project(project_id, current_user.org_id, db)
    top_queries = await analytics_service.get_top_queries(project_id, current_user.org_id, db)
    tracked = set((await db.execute(select(TrackedKeyword.keyword).where(
        TrackedKeyword.project_id == project_id, TrackedKeyword.org_id == current_user.org_id))).scalars().all())
    suggestions = [
        {"keyword": q.query, "impressions": q.impressions}
        for q in top_queries if q.query not in tracked
    ]
    return suggestions[:10]
