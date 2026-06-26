# apps/api/app/workers/tasks/analytics_tasks.py
"""ARQ tasks for analytics data: historical seed + daily sync."""
import math
import random
import uuid
from datetime import date, timedelta

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.analytics import AnalyticsSnapshot, KeywordRanking
from app.models.keyword import Keyword, KeywordResearchJob, ResearchStatus


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


async def sync_analytics_data(ctx, project_id: str):
    """Daily sync: write today's analytics row and keyword ranking rows."""
    pid = uuid.UUID(project_id)
    today = date.today()

    async with async_session_factory() as session:
        kw_result = await session.execute(
            select(Keyword).where(Keyword.project_id == pid).limit(1)
        )
        sample_kw = kw_result.scalar_one_or_none()
        if sample_kw is None:
            return
        org_id = sample_kw.org_id

        all_kw_result = await session.execute(
            select(Keyword).where(Keyword.project_id == pid, Keyword.org_id == org_id)
        )
        keywords = all_kw_result.scalars().all()

        total_volume = sum(kw.search_volume or 0 for kw in keywords) or 1000
        base_clicks_daily = total_volume * 0.02 / 30
        rng = random.Random(int(pid) + today.toordinal())
        variance = rng.uniform(0.8, 1.2)
        clicks = max(0, int(base_clicks_daily * variance))
        impressions = max(clicks, int(clicks * rng.uniform(8.0, 15.0)))
        ctr = round(clicks / impressions, 4) if impressions else 0.0
        all_positions = [_base_position(kw.difficulty) for kw in keywords]
        avg_pos = round(sum(all_positions) / len(all_positions), 1) if all_positions else 10.0

        snap = AnalyticsSnapshot(
            project_id=pid,
            org_id=org_id,
            date=today,
            clicks=clicks,
            impressions=impressions,
            ctr=ctr,
            avg_position=avg_pos,
        )
        session.add(snap)

        for kw in keywords:
            base_pos = _base_position(kw.difficulty)
            pos = _daily_position_drift(base_pos, 0, seed=hash(str(kw.id)) % 100000)
            ranking = KeywordRanking(
                keyword_id=kw.id,
                project_id=pid,
                org_id=org_id,
                date=today,
                position=pos,
                url=f"https://example.com/{kw.keyword.replace(' ', '-').lower()}/",
            )
            session.add(ranking)

        await session.commit()
