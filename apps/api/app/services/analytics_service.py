# apps/api/app/services/analytics_service.py
import uuid
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics import AnalyticsSnapshot, GscConnection, KeywordRanking
from app.models.article import Article
from app.models.keyword import Keyword
from app.schemas.analytics import (
    AnalyticsOverview,
    ContentPerformanceRow,
    GscConnectionStatus,
    RankingRow,
    TopPageRow,
    TopQueryRow,
    TrafficDataPoint,
)


def _parse_range(range_str: str) -> tuple[date, date]:
    today = date.today()
    days = {"7d": 7, "28d": 28, "90d": 90}.get(range_str, 28)
    return today - timedelta(days=days - 1), today


def _pct_change(current: float, previous: float) -> float:
    if previous == 0:
        return 0.0
    return round((current - previous) / previous * 100, 1)


async def get_overview(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    range_str: str,
    db: AsyncSession,
) -> AnalyticsOverview:
    start, end = _parse_range(range_str)
    period_len = (end - start).days + 1
    prior_end = start - timedelta(days=1)
    prior_start = prior_end - timedelta(days=period_len - 1)

    async def _agg(s: date, e: date):
        result = await db.execute(
            select(
                func.coalesce(func.sum(AnalyticsSnapshot.clicks), 0),
                func.coalesce(func.sum(AnalyticsSnapshot.impressions), 0),
                func.coalesce(func.avg(AnalyticsSnapshot.ctr), 0.0),
                func.coalesce(func.avg(AnalyticsSnapshot.avg_position), 0.0),
            ).where(
                AnalyticsSnapshot.project_id == project_id,
                AnalyticsSnapshot.org_id == org_id,
                AnalyticsSnapshot.date >= s,
                AnalyticsSnapshot.date <= e,
            )
        )
        row = result.one()
        return int(row[0]), int(row[1]), float(row[2]), float(row[3])

    clicks, impressions, ctr, avg_pos = await _agg(start, end)
    p_clicks, p_impressions, p_ctr, p_avg_pos = await _agg(prior_start, prior_end)

    return AnalyticsOverview(
        clicks=clicks,
        impressions=impressions,
        ctr=round(ctr, 4),
        avg_position=round(avg_pos, 1),
        clicks_change=_pct_change(clicks, p_clicks),
        impressions_change=_pct_change(impressions, p_impressions),
        ctr_change=_pct_change(ctr, p_ctr),
        position_change=_pct_change(avg_pos, p_avg_pos),
    )


async def get_traffic(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    range_str: str,
    db: AsyncSession,
) -> list[TrafficDataPoint]:
    start, end = _parse_range(range_str)
    result = await db.execute(
        select(AnalyticsSnapshot)
        .where(
            AnalyticsSnapshot.project_id == project_id,
            AnalyticsSnapshot.org_id == org_id,
            AnalyticsSnapshot.date >= start,
            AnalyticsSnapshot.date <= end,
        )
        .order_by(AnalyticsSnapshot.date.asc())
    )
    return [
        TrafficDataPoint(
            date=r.date,
            clicks=r.clicks,
            impressions=r.impressions,
            ctr=r.ctr,
            avg_position=r.avg_position,
        )
        for r in result.scalars().all()
    ]


async def get_rankings(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
    sort_by: str = "position",
    page: int = 1,
    page_size: int = 25,
) -> list[RankingRow]:
    today = date.today()
    week_ago = today - timedelta(days=7)

    kw_result = await db.execute(
        select(Keyword).where(
            Keyword.project_id == project_id,
            Keyword.org_id == org_id,
        )
    )
    keywords = kw_result.scalars().all()
    if not keywords:
        return []

    keyword_ids = [kw.id for kw in keywords]
    kw_map = {kw.id: kw for kw in keywords}

    latest_result = await db.execute(
        select(KeywordRanking).where(
            KeywordRanking.keyword_id.in_(keyword_ids),
            KeywordRanking.date == today,
        )
    )
    latest_map = {r.keyword_id: r for r in latest_result.scalars().all()}

    week_result = await db.execute(
        select(KeywordRanking).where(
            KeywordRanking.keyword_id.in_(keyword_ids),
            KeywordRanking.date == week_ago,
        )
    )
    week_map = {r.keyword_id: r for r in week_result.scalars().all()}

    rows: list[RankingRow] = []
    for kw in keywords:
        latest = latest_map.get(kw.id)
        week_old = week_map.get(kw.id)
        current_pos = latest.position if latest else None
        change: Optional[float] = None
        if current_pos is not None and week_old is not None:
            change = round(current_pos - week_old.position, 1)
        rows.append(
            RankingRow(
                keyword_id=kw.id,
                keyword=kw.keyword,
                search_volume=kw.search_volume,
                intent=kw.intent.value if kw.intent else None,
                difficulty=kw.difficulty,
                current_position=current_pos,
                position_change=change,
            )
        )

    if sort_by == "position":
        rows.sort(key=lambda r: r.current_position or 999.0)
    elif sort_by == "volume":
        rows.sort(key=lambda r: r.search_volume or 0, reverse=True)
    elif sort_by == "change":
        rows.sort(key=lambda r: r.position_change or 0.0)

    offset = (page - 1) * page_size
    return rows[offset : offset + page_size]


async def get_top_pages(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> list[TopPageRow]:
    today = date.today()
    result = await db.execute(
        select(KeywordRanking, Keyword)
        .join(Keyword, KeywordRanking.keyword_id == Keyword.id)
        .where(
            KeywordRanking.project_id == project_id,
            KeywordRanking.org_id == org_id,
            KeywordRanking.date == today,
            KeywordRanking.url.isnot(None),
        )
    )
    rows_raw = result.all()

    # Group by URL
    url_data: dict[str, dict] = {}
    for ranking, kw in rows_raw:
        url = ranking.url
        if url not in url_data:
            url_data[url] = {"volume": 0, "positions": [], "count": 0}
        url_data[url]["volume"] += kw.search_volume or 0
        url_data[url]["positions"].append(ranking.position)
        url_data[url]["count"] += 1

    pages: list[TopPageRow] = []
    for url, data in url_data.items():
        vol = data["volume"]
        clicks = int(vol * 0.02)
        impressions = int(vol * 0.24)
        avg_pos = round(sum(data["positions"]) / len(data["positions"]), 1)
        pages.append(
            TopPageRow(
                url=url,
                clicks=clicks,
                impressions=impressions,
                ctr=round(clicks / impressions, 4) if impressions else 0.0,
                avg_position=avg_pos,
            )
        )

    pages.sort(key=lambda p: p.clicks, reverse=True)
    return pages[:20]


async def get_top_queries(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> list[TopQueryRow]:
    today = date.today()
    result = await db.execute(
        select(KeywordRanking, Keyword)
        .join(Keyword, KeywordRanking.keyword_id == Keyword.id)
        .where(
            KeywordRanking.project_id == project_id,
            KeywordRanking.org_id == org_id,
            KeywordRanking.date == today,
        )
        .order_by(Keyword.search_volume.desc().nullslast())
        .limit(20)
    )
    rows_raw = result.all()

    queries: list[TopQueryRow] = []
    for ranking, kw in rows_raw:
        vol = kw.search_volume or 100
        clicks = int(vol * 0.02)
        impressions = int(vol * 0.24)
        queries.append(
            TopQueryRow(
                query=kw.keyword,
                clicks=clicks,
                impressions=impressions,
                ctr=round(clicks / impressions, 4) if impressions else 0.0,
                avg_position=round(ranking.position, 1),
            )
        )
    return queries


async def get_content_performance(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> list[ContentPerformanceRow]:
    today = date.today()
    art_result = await db.execute(
        select(Article).where(
            Article.project_id == project_id,
            Article.org_id == org_id,
        ).order_by(Article.created_at.desc())
    )
    articles = art_result.scalars().all()

    rows: list[ContentPerformanceRow] = []
    for article in articles:
        published_url: Optional[str] = getattr(article, "published_url", None)
        clicks = 0
        impressions = 0

        if published_url:
            rank_result = await db.execute(
                select(KeywordRanking, Keyword)
                .join(Keyword, KeywordRanking.keyword_id == Keyword.id)
                .where(
                    KeywordRanking.project_id == project_id,
                    KeywordRanking.org_id == org_id,
                    KeywordRanking.date == today,
                    KeywordRanking.url == published_url,
                )
            )
            for _, kw in rank_result.all():
                vol = kw.search_volume or 100
                clicks += int(vol * 0.02)
                impressions += int(vol * 0.24)

        rows.append(
            ContentPerformanceRow(
                article_id=article.id,
                title=article.title,
                published_url=published_url,
                status=article.status.value,
                clicks=clicks,
                impressions=impressions,
                ctr=round(clicks / impressions, 4) if impressions else 0.0,
            )
        )
    return rows


async def get_gsc_status(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> GscConnectionStatus:
    result = await db.execute(
        select(GscConnection).where(
            GscConnection.project_id == project_id,
            GscConnection.org_id == org_id,
        )
    )
    conn = result.scalar_one_or_none()
    if not conn or not conn.is_active:
        return GscConnectionStatus(
            is_connected=False,
            google_email=None,
            site_url=None,
            last_synced_at=None,
        )
    return GscConnectionStatus(
        is_connected=True,
        google_email=conn.google_email,
        site_url=conn.site_url,
        last_synced_at=conn.last_synced_at,
    )
