"""Monitoring: alerts inbox + competitor watchlist."""
import uuid
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select, update

from app.core.dependencies import CurrentUser, DB
from app.models.monitoring import Alert, WatchedCompetitor
from app.models.project import Project

router = APIRouter()

WATCHLIST_CAP = 10


async def _assert_project(project_id, org_id, db):
    proj = (await db.execute(select(Project).where(
        Project.id == project_id, Project.org_id == org_id))).scalars().first()
    if proj is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")


def _alert(a: Alert) -> dict:
    return {"id": str(a.id), "kind": a.kind, "severity": a.severity, "title": a.title,
            "detail": a.detail, "url": a.url, "is_read": a.is_read,
            "created_at": a.created_at.isoformat() if a.created_at else None}


@router.get("/alerts")
async def list_alerts(project_id: uuid.UUID, current_user: CurrentUser, db: DB,
                      unread_only: bool = False, kind: str | None = None, limit: int = 50):
    q = select(Alert).where(Alert.project_id == project_id, Alert.org_id == current_user.org_id)
    if unread_only:
        q = q.where(Alert.is_read.is_(False))
    if kind:
        q = q.where(Alert.kind == kind)
    rows = (await db.execute(q.order_by(Alert.created_at.desc()).limit(min(limit, 200)))).scalars().all()
    return [_alert(a) for a in rows]


@router.post("/alerts/{alert_id}/read")
async def mark_read(alert_id: uuid.UUID, current_user: CurrentUser, db: DB):
    a = (await db.execute(select(Alert).where(
        Alert.id == alert_id, Alert.org_id == current_user.org_id))).scalars().first()
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Alert not found")
    a.is_read = True
    await db.flush()
    return {"ok": True}


@router.post("/alerts/read-all")
async def mark_all_read(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(update(Alert).where(
        Alert.project_id == project_id, Alert.org_id == current_user.org_id,
        Alert.is_read.is_(False)).values(is_read=True))
    await db.flush()
    return {"marked": result.rowcount or 0}


@router.get("/alerts/unread-count")
async def unread_count(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    n = (await db.execute(select(func.count()).select_from(Alert).where(
        Alert.project_id == project_id, Alert.org_id == current_user.org_id,
        Alert.is_read.is_(False)))).scalar() or 0
    return {"count": n}


class WatchIn(BaseModel):
    project_id: uuid.UUID
    url: str
    label: str | None = None


def _watch(w: WatchedCompetitor) -> dict:
    return {"id": str(w.id), "url": w.url, "label": w.label, "last_scanned_at": w.last_scanned_at}


@router.get("/competitors")
async def list_watchlist(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    rows = (await db.execute(select(WatchedCompetitor).where(
        WatchedCompetitor.project_id == project_id,
        WatchedCompetitor.org_id == current_user.org_id))).scalars().all()
    return [_watch(w) for w in rows]


@router.post("/competitors", status_code=status.HTTP_201_CREATED)
async def add_watch(body: WatchIn, current_user: CurrentUser, db: DB):
    await _assert_project(body.project_id, current_user.org_id, db)
    parsed = urlparse(body.url.strip())
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Enter a valid http(s) URL.")
    count = (await db.execute(select(func.count()).select_from(WatchedCompetitor).where(
        WatchedCompetitor.project_id == body.project_id,
        WatchedCompetitor.org_id == current_user.org_id))).scalar() or 0
    if count >= WATCHLIST_CAP:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Watchlist is limited to {WATCHLIST_CAP} competitors.")
    dup = (await db.execute(select(WatchedCompetitor).where(
        WatchedCompetitor.project_id == body.project_id,
        WatchedCompetitor.url == body.url.strip()))).scalars().first()
    if dup is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already on the watchlist.")
    w = WatchedCompetitor(org_id=current_user.org_id, project_id=body.project_id,
                          url=body.url.strip(), label=(body.label or None))
    db.add(w)
    await db.flush()
    await db.refresh(w)
    return _watch(w)


@router.delete("/competitors/{watch_id}")
async def remove_watch(watch_id: uuid.UUID, current_user: CurrentUser, db: DB):
    w = (await db.execute(select(WatchedCompetitor).where(
        WatchedCompetitor.id == watch_id,
        WatchedCompetitor.org_id == current_user.org_id))).scalars().first()
    if w is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await db.delete(w)
    await db.flush()
    return {"ok": True}
