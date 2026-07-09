# apps/api/app/workers/tasks/analytics_tasks.py
"""ARQ tasks for analytics data: historical seed + daily sync."""
import random
import uuid
from datetime import date, timedelta

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.analytics import AnalyticsSnapshot, KeywordRanking
from app.models.keyword import Keyword


def _base_position(difficulty: float | None) -> float:
    """Convert keyword difficulty (0–100) to a mock starting rank position (1–50)."""
    d = difficulty or 50.0
    # difficulty 0 → position ~2, difficulty 100 → position ~48
    return round(2.0 + (d / 100.0) * 46.0, 1)


def _daily_position_drift(base: float, day_offset: int, seed: int) -> float:
    """Apply deterministic per-day drift so position history looks realistic."""
    rng = random.Random(seed + day_offset)
    drift = rng.uniform(-1.5, 1.5)
    pos = max(1.0, min(100.0, base + drift))
    return round(pos, 1)


async def seed_analytics_history(ctx, project_id: str):
    """Seed 90 days of mock analytics_snapshots and keyword_rankings."""
    pid = uuid.UUID(project_id)
    today = date.today()

    async with async_session_factory() as session:
        # Resolve org_id from a keyword (or skip if no keywords yet)
        kw_result = await session.execute(
            select(Keyword).where(Keyword.project_id == pid).limit(1)
        )
        sample_kw = kw_result.scalar_one_or_none()
        if sample_kw is None:
            return  # No keywords yet — will be seeded after keyword research runs
        org_id = sample_kw.org_id

        # Get all keywords for this project
        all_kw_result = await session.execute(
            select(Keyword).where(Keyword.project_id == pid, Keyword.org_id == org_id)
        )
        keywords = all_kw_result.scalars().all()

        # Base analytics from keyword volumes
        total_volume = sum(kw.search_volume or 0 for kw in keywords) or 1000
        base_clicks_daily = total_volume * 0.02 / 30  # rough daily share

        for day_offset in range(89, -1, -1):  # 89 days ago → today
            snap_date = today - timedelta(days=day_offset)
            rng = random.Random(int(pid) + day_offset)
            variance = rng.uniform(0.8, 1.2)
            clicks = max(0, int(base_clicks_daily * variance))
            impressions = max(clicks, int(clicks * rng.uniform(8.0, 15.0)))
            ctr = round(clicks / impressions, 4) if impressions else 0.0
            all_positions = [
                _base_position(kw.difficulty) for kw in keywords
            ]
            avg_pos = round(sum(all_positions) / len(all_positions), 1) if all_positions else 10.0

            snap = AnalyticsSnapshot(
                project_id=pid,
                org_id=org_id,
                date=snap_date,
                clicks=clicks,
                impressions=impressions,
                ctr=ctr,
                avg_position=avg_pos,
            )
            session.add(snap)

            # One keyword_ranking per keyword per day
            for kw in keywords:
                base_pos = _base_position(kw.difficulty)
                pos = _daily_position_drift(base_pos, day_offset, seed=hash(str(kw.id)) % 100000)
                ranking = KeywordRanking(
                    keyword_id=kw.id,
                    project_id=pid,
                    org_id=org_id,
                    date=snap_date,
                    position=pos,
                    url=f"https://example.com/{kw.keyword.replace(' ', '-').lower()}/",
                )
                session.add(ranking)

        await session.commit()


async def _sync_one_project(project_id: str):
    """Refresh a single project's analytics.

    If the project has an active Google Search Console connection, pull REAL data
    (and never fabricate — synthetic rows would pollute the real figures). Only
    projects without GSC fall back to synthetic demo snapshots.
    """
    pid = uuid.UUID(project_id)
    today = date.today()

    async with async_session_factory() as session:
        from app.models.analytics import GscConnection
        gsc_conn = (await session.execute(
            select(GscConnection).where(
                GscConnection.project_id == pid,
                GscConnection.is_active.is_(True),
            )
        )).scalars().first()

        if gsc_conn is not None:
            # Real Search Console data only. gsc_service.sync commits internally.
            org_id = gsc_conn.org_id
            from app.services import gsc_service
            try:
                await gsc_service.sync(pid, org_id, session)
            except Exception:
                pass  # best-effort; on failure leave existing real data untouched
        else:
            # No GSC connection → nothing real to sync. We never fabricate
            # synthetic figures (they would look like real traffic on the home).
            return

        # Closed-loop recommendation tracking: re-measure + detect after fresh data.
        from app.services.recommendation_service import measure, run_matching
        try:
            await measure(pid, org_id, session)
            await run_matching(pid, org_id, session)
        except Exception:
            pass  # never let tracking break the nightly analytics sync


async def _sync_synthetic(pid, today, session) -> uuid.UUID | None:
    """Fallback demo data for projects with no GSC connection. Returns org_id, or
    None if the project has no keywords to base synthetic figures on."""
    sample_kw = (await session.execute(
        select(Keyword).where(Keyword.project_id == pid).limit(1)
    )).scalar_one_or_none()
    if sample_kw is None:
        return None
    org_id = sample_kw.org_id

    keywords = (await session.execute(
        select(Keyword).where(Keyword.project_id == pid, Keyword.org_id == org_id)
    )).scalars().all()

    total_volume = sum(kw.search_volume or 0 for kw in keywords) or 1000
    base_clicks_daily = total_volume * 0.02 / 30
    rng = random.Random(int(pid) + today.toordinal())
    variance = rng.uniform(0.8, 1.2)
    clicks = max(0, int(base_clicks_daily * variance))
    impressions = max(clicks, int(clicks * rng.uniform(8.0, 15.0)))
    ctr = round(clicks / impressions, 4) if impressions else 0.0
    all_positions = [_base_position(kw.difficulty) for kw in keywords]
    avg_pos = round(sum(all_positions) / len(all_positions), 1) if all_positions else 10.0

    session.add(AnalyticsSnapshot(
        project_id=pid, org_id=org_id, date=today,
        clicks=clicks, impressions=impressions, ctr=ctr, avg_position=avg_pos,
    ))
    for kw in keywords:
        base_pos = _base_position(kw.difficulty)
        pos = _daily_position_drift(base_pos, 0, seed=hash(str(kw.id)) % 100000)
        session.add(KeywordRanking(
            keyword_id=kw.id, project_id=pid, org_id=org_id, date=today,
            position=pos, url=f"https://example.com/{kw.keyword.replace(' ', '-').lower()}/",
        ))
    await session.commit()
    return org_id


async def sync_analytics_data(ctx, project_id: str | None = None):
    """Daily sync: write today's analytics row and keyword ranking rows.
    Called by cron (no project_id → syncs all projects) or directly per-project.
    """
    if project_id is None:
        # Called from cron — sync all projects
        async with async_session_factory() as session:
            from app.models.project import Project
            result = await session.execute(select(Project))
            projects = result.scalars().all()
        for p in projects:
            await _sync_one_project(str(p.id))
        return

    await _sync_one_project(project_id)
