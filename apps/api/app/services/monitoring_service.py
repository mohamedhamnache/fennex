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
from app.services.competitor_service import scan_scorecard

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


WC_CHANGE_RATIO = 0.20
H2_CHANGE_MIN = 3


def _scorecard_changes(old: dict, new: dict) -> list[str]:
    changes: list[str] = []
    if (new.get("title") or "") != (old.get("title") or ""):
        changes.append("title changed")
    if (new.get("meta_description") or "") != (old.get("meta_description") or ""):
        changes.append("meta description changed")
    old_wc, new_wc = int(old.get("word_count") or 0), int(new.get("word_count") or 0)
    if old_wc and abs(new_wc - old_wc) / old_wc >= WC_CHANGE_RATIO:
        changes.append(f"word count {old_wc} -> {new_wc}")
    if abs(int(new.get("h2_count") or 0) - int(old.get("h2_count") or 0)) >= H2_CHANGE_MIN:
        changes.append(f"headings {old.get('h2_count')} -> {new.get('h2_count')}")
    added = set(new.get("schema_types") or []) - set(old.get("schema_types") or [])
    if added:
        changes.append("schema added: " + ", ".join(sorted(added)))
    return changes


async def detect_competitors(project_id, org_id, db: AsyncSession) -> int:
    """Sable: re-scan watched competitor pages and alert on scorecard changes."""
    watches = (await db.execute(select(WatchedCompetitor).where(
        WatchedCompetitor.project_id == project_id,
    ))).scalars().all()
    created = 0
    wk = _iso_week()
    for w in watches:
        try:
            card = await scan_scorecard(w.url)
        except Exception:
            logger.warning("competitor scan failed, skipping: %s", w.url)
            continue
        if w.last_scorecard:
            changes = _scorecard_changes(w.last_scorecard, card)
            if changes:
                if await _create_alert(
                    project_id, org_id, kind="competitor_change", severity="warning",
                    title=f"Competitor changed: {w.label or w.url}",
                    detail="; ".join(changes) + ".",
                    url=f"/{project_id}/analytics?ws=competitors",
                    dedupe_key=f"competitor_change:{w.url}:{wk}", db=db,
                ):
                    created += 1
        w.last_scorecard = card
        w.last_scanned_at = _now_iso()
    await db.commit()
    return created


MARKET_NEW_MIN_IMPRESSIONS = 50
MARKET_RISER_MIN_IMPRESSIONS = 100
MARKET_RISER_RATIO = 2.0
MARKET_TOP_FINDINGS = 5


async def detect_market(project_id, org_id, db: AsyncSession) -> int:
    """Oasis: new demand and rising queries vs last week's snapshot - one alert/week."""
    stats = (await db.execute(select(GscQueryStat).where(
        GscQueryStat.project_id == project_id,
    ).order_by(GscQueryStat.impressions.desc()).limit(TOP_QUERIES))).scalars().all()
    current = {s.query: int(s.impressions or 0) for s in stats}
    prev = await _prev_snapshot(project_id, "market", db)
    created = 0
    if prev is not None:
        findings: list[tuple[int, str]] = []
        for q, imp in current.items():
            old = prev.get(q)
            if old is None and imp >= MARKET_NEW_MIN_IMPRESSIONS:
                findings.append((imp, f"new demand: '{q}' ({imp} impressions)"))
            elif old and imp >= MARKET_RISER_MIN_IMPRESSIONS and imp >= MARKET_RISER_RATIO * old:
                findings.append((imp, f"rising: '{q}' ({old} -> {imp} impressions)"))
        if findings:
            top = [line for _, line in sorted(findings, reverse=True)[:MARKET_TOP_FINDINGS]]
            if await _create_alert(
                project_id, org_id, kind="market_shift", severity="info",
                title=f"Market shift: {len(findings)} queries moved",
                detail="; ".join(top) + ".",
                url=f"/{project_id}/analytics?ws=market",
                dedupe_key=f"market_shift:{_iso_week()}", db=db,
            ):
                created += 1
    await _store_snapshot(project_id, org_id, "market", current, db)
    await db.commit()
    return created
