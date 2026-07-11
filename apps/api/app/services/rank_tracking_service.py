"""Tracked-keyword CRUD, daily snapshots, history and deltas."""
import logging
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.seo_intel import SerpSnapshot, TrackedKeyword
from app.services import serp_service

logger = logging.getLogger(__name__)

TRACKED_CAP = 25
NOT_RANKED = 101.0


class CapReached(Exception): ...
class DuplicateKeyword(Exception): ...


async def add_keyword(project, keyword: str, db: AsyncSession) -> TrackedKeyword:
    kw = " ".join((keyword or "").split()).strip()
    if not kw:
        raise ValueError("keyword required")
    dup = (await db.execute(select(TrackedKeyword).where(
        TrackedKeyword.project_id == project.id,
        TrackedKeyword.keyword == kw))).scalars().first()
    if dup is not None:
        raise DuplicateKeyword(kw)
    count = (await db.execute(select(func.count()).select_from(TrackedKeyword).where(
        TrackedKeyword.project_id == project.id,
        TrackedKeyword.is_active.is_(True)))).scalar() or 0
    if count >= TRACKED_CAP:
        raise CapReached(TRACKED_CAP)
    tk = TrackedKeyword(org_id=project.org_id, project_id=project.id, keyword=kw,
                        language=serp_service.language_for_project(project),
                        location_code=serp_service.location_for_project(project))
    db.add(tk)
    await db.commit()
    await db.refresh(tk)
    return tk


async def remove_keyword(keyword_id, org_id, db: AsyncSession) -> bool:
    tk = (await db.execute(select(TrackedKeyword).where(
        TrackedKeyword.id == keyword_id, TrackedKeyword.org_id == org_id))).scalars().first()
    if tk is None:
        return False
    await db.delete(tk)
    await db.commit()
    return True


def _pos(v: float | None) -> float:
    return v if v is not None else NOT_RANKED


async def snapshot_keyword(project, tk: TrackedKeyword, db: AsyncSession) -> SerpSnapshot | None:
    today = date.today()
    existing = (await db.execute(select(SerpSnapshot).where(
        SerpSnapshot.tracked_keyword_id == tk.id, SerpSnapshot.date == today))).scalars().first()
    if existing is not None:
        return None
    res = await serp_service.fetch_serp(project, tk.keyword, db)
    if res is None:
        return None
    snap = SerpSnapshot(org_id=project.org_id, project_id=project.id, tracked_keyword_id=tk.id,
                        date=today, position=res["position"], url=res["url"],
                        top10=res["top10"], features=res["features"])
    db.add(snap)
    await db.commit()
    await db.refresh(snap)
    return snap


async def _snapshots_since(project_id, since: date, db) -> list[SerpSnapshot]:
    return list((await db.execute(select(SerpSnapshot).where(
        SerpSnapshot.project_id == project_id, SerpSnapshot.date >= since,
    ).order_by(SerpSnapshot.date))).scalars().all())


async def list_with_stats(project_id, org_id, db: AsyncSession) -> list[dict]:
    tks = list((await db.execute(select(TrackedKeyword).where(
        TrackedKeyword.project_id == project_id, TrackedKeyword.org_id == org_id,
        TrackedKeyword.is_active.is_(True)).order_by(TrackedKeyword.created_at))).scalars().all())
    snaps = await _snapshots_since(project_id, date.today() - timedelta(days=31), db)
    by_kw: dict = {}
    for s in snaps:
        by_kw.setdefault(s.tracked_keyword_id, []).append(s)

    def closest(hist: list[SerpSnapshot], days_ago: int) -> SerpSnapshot | None:
        target = date.today() - timedelta(days=days_ago)
        older = [s for s in hist if s.date <= target]
        return older[-1] if older else None

    rows = []
    for tk in tks:
        hist = by_kw.get(tk.id, [])
        latest = hist[-1] if hist else None
        d7 = closest(hist, 7)
        d30 = closest(hist, 30)
        rows.append({
            "id": str(tk.id), "keyword": tk.keyword,
            "position": latest.position if latest else None,
            "url": latest.url if latest else None,
            "features": (latest.features or []) if latest else [],
            "last_checked": latest.date.isoformat() if latest else None,
            "delta_7d": (_pos(d7.position) - _pos(latest.position)) if latest and d7 else None,
            "delta_30d": (_pos(d30.position) - _pos(latest.position)) if latest and d30 else None,
            "spark": [{"date": s.date.isoformat(), "position": s.position} for s in hist],
        })
    return rows


async def history(keyword_id, org_id, days: int, db: AsyncSession) -> dict | None:
    tk = (await db.execute(select(TrackedKeyword).where(
        TrackedKeyword.id == keyword_id, TrackedKeyword.org_id == org_id))).scalars().first()
    if tk is None:
        return None
    snaps = list((await db.execute(select(SerpSnapshot).where(
        SerpSnapshot.tracked_keyword_id == tk.id,
        SerpSnapshot.date >= date.today() - timedelta(days=days),
    ).order_by(SerpSnapshot.date))).scalars().all())
    latest = snaps[-1] if snaps else None
    return {"keyword": tk.keyword,
            "points": [{"date": s.date.isoformat(), "position": s.position} for s in snaps],
            "top10": (latest.top10 or []) if latest else [],
            "features": (latest.features or []) if latest else [],
            "url": latest.url if latest else None}
