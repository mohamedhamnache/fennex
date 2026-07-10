"""Snapshot-diff monitoring engine: Zerda (rankings), Sable (competitors),
Oasis (market). Deterministic - no LLM calls. First run per (project, kind)
stores the snapshot and emits nothing."""
import logging
import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics import GscQueryStat
from app.models.monitoring import Alert, MonitorSnapshot, WatchedCompetitor

logger = logging.getLogger(__name__)

TOP_QUERIES = 200
DROP_POSITIONS = 3.0
DROP_MIN_IMPRESSIONS = 50
GAIN_POSITIONS = 3.0


def _iso_week(d: date | None = None) -> str:
    d = d or date.today()
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _prev_snapshot(project_id, kind: str, db: AsyncSession) -> dict | None:
    row = (await db.execute(select(MonitorSnapshot).where(
        MonitorSnapshot.project_id == project_id, MonitorSnapshot.kind == kind,
    ))).scalars().first()
    return row.payload if row is not None else None


async def _store_snapshot(project_id, org_id, kind: str, payload: dict, db: AsyncSession) -> None:
    row = (await db.execute(select(MonitorSnapshot).where(
        MonitorSnapshot.project_id == project_id, MonitorSnapshot.kind == kind,
    ))).scalars().first()
    if row is None:
        db.add(MonitorSnapshot(project_id=project_id, org_id=org_id, kind=kind,
                               payload=payload, taken_at=_now_iso()))
    else:
        row.payload = payload
        row.taken_at = _now_iso()


async def _create_alert(project_id, org_id, *, kind: str, severity: str, title: str,
                        detail: str | None, url: str, dedupe_key: str, db: AsyncSession) -> bool:
    existing = (await db.execute(select(Alert).where(
        Alert.project_id == project_id, Alert.dedupe_key == dedupe_key,
    ))).scalars().first()
    if existing is not None:
        return False
    db.add(Alert(project_id=project_id, org_id=org_id, kind=kind, severity=severity,
                 title=title[:500], detail=detail, url=url[:500], dedupe_key=dedupe_key[:200]))
    return True


async def detect_rankings(project_id, org_id, db: AsyncSession) -> int:
    """Zerda: diff query positions vs the previous sync's snapshot."""
    stats = (await db.execute(select(GscQueryStat).where(
        GscQueryStat.project_id == project_id,
    ).order_by(GscQueryStat.impressions.desc()).limit(TOP_QUERIES))).scalars().all()
    current = {s.query: {"position": float(s.position or 0.0), "clicks": int(s.clicks or 0),
                         "impressions": int(s.impressions or 0)} for s in stats}
    prev = await _prev_snapshot(project_id, "rankings", db)
    created = 0
    if prev is not None:
        wk = _iso_week()
        base = f"/{project_id}/analytics"
        for q, cur in current.items():
            old = prev.get(q)
            if not old:
                continue
            delta = cur["position"] - float(old.get("position") or 0.0)
            if delta >= DROP_POSITIONS and cur["impressions"] >= DROP_MIN_IMPRESSIONS:
                fell_off = float(old["position"]) <= 10.0 < cur["position"]
                if await _create_alert(
                    project_id, org_id, kind="ranking_drop",
                    severity="critical" if fell_off else "warning",
                    title=f"Ranking drop: '{q}'",
                    detail=(f"Position {old['position']:.1f} -> {cur['position']:.1f} "
                            f"({cur['impressions']} impressions)."),
                    url=base, dedupe_key=f"ranking_drop:{q}:{wk}", db=db,
                ):
                    created += 1
            elif delta <= -GAIN_POSITIONS and cur["position"] <= 10.0:
                if await _create_alert(
                    project_id, org_id, kind="ranking_gain", severity="info",
                    title=f"Ranking gain: '{q}'",
                    detail=(f"Position {old['position']:.1f} -> {cur['position']:.1f} "
                            f"({cur['impressions']} impressions)."),
                    url=base, dedupe_key=f"ranking_gain:{q}:{wk}", db=db,
                ):
                    created += 1
    await _store_snapshot(project_id, org_id, "rankings", current, db)
    await db.commit()
    return created
