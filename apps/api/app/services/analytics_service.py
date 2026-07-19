# apps/api/app/services/analytics_service.py
import uuid
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics import AnalyticsSnapshot, GscConnection, GscPageStat, GscQueryStat, KeywordRanking
from app.models.article import Article
from app.models.keyword import Keyword
from app.schemas.analytics import (
    AnalyticsOverview,
    ContentPerformanceRow,
    GscConnectionStatus,
    OpportunitiesResponse,
    OpportunityRow,
    ContentIdea,
    HealthComponent,
    HealthScore,
    MarketInsights,
    RankingRow,
    TopicCluster,
    TopPageRow,
    TopQueryRow,
    TrafficDataPoint,
    NorthStar,
    SecondaryMetric,
    FocusItem,
    FocusList,
    PersonaHome,
    PlanHint,
    PlanGrounding,
)


# Industry-average organic CTR by SERP position (used for opportunity estimates).
_CTR_BY_POS = {1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.06, 6: 0.05, 7: 0.04, 8: 0.032, 9: 0.028, 10: 0.025}


def _expected_ctr(pos: float) -> float:
    p = int(round(pos))
    if p <= 10:
        return _CTR_BY_POS.get(max(1, p), 0.025)
    if p <= 20:
        return 0.015
    return 0.008


_STOPWORDS = {
    "the", "a", "an", "and", "or", "for", "to", "of", "in", "on", "at", "is", "are", "was",
    "with", "my", "your", "you", "i", "it", "this", "that", "how", "what", "why", "when",
    "where", "who", "which", "can", "do", "does", "vs", "best", "top", "near", "me", "from",
    "by", "as", "be", "will", "not", "no", "yes", "get", "has", "have", "&",
}
_QUESTION_STARTS = ("how ", "what ", "why ", "when ", "where ", "who ", "which ", "can ", "do ", "does ", "is ", "are ")
_COMMERCIAL = {"buy", "price", "prices", "pricing", "cheap", "deal", "deals", "shop", "coupon", "discount", "sale", "cost", "order", "store", "shipping"}
_COMPARISON = {"vs", "versus", "or", "compare", "comparison", "alternative", "alternatives", "difference"}
_LIST = {"best", "top", "ideas", "examples", "list", "tips"}


def _classify_query(q: str) -> str:
    ql = q.lower()
    words = set(ql.split())
    if ql.startswith("how "):
        return "how-to"
    if ql.startswith(_QUESTION_STARTS):
        return "question"
    if words & _COMPARISON:
        return "comparison"
    if words & _COMMERCIAL:
        return "commercial"
    if words & _LIST:
        return "list"
    return "informational"


async def get_market_insights(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> MarketInsights:
    """Persona market study from real GSC queries: topic clusters + content ideas."""
    result = await db.execute(
        select(GscQueryStat).where(
            GscQueryStat.project_id == project_id,
            GscQueryStat.org_id == org_id,
        )
    )
    stats = list(result.scalars().all())

    total_clicks = sum(s.clicks for s in stats)
    total_impressions = sum(s.impressions for s in stats)

    # ── Topic clusters — group queries by their most-shared significant term ──
    def _tokens(q: str) -> list[str]:
        return [w for w in "".join(c if c.isalnum() or c == " " else " " for c in q.lower()).split()
                if len(w) > 2 and w not in _STOPWORDS]

    df: dict[str, int] = {}
    for s in stats:
        for w in set(_tokens(s.query)):
            df[w] = df.get(w, 0) + 1

    clusters: dict[str, dict] = {}
    for s in stats:
        toks = _tokens(s.query)
        if not toks:
            continue
        # Cluster key = the token shared by the most queries (only if shared by >=2)
        head = max(toks, key=lambda w: df.get(w, 0))
        if df.get(head, 0) < 2:
            continue
        c = clusters.setdefault(head, {"count": 0, "clicks": 0, "impr": 0, "pos_w": 0.0, "top": (0, "")})
        c["count"] += 1
        c["clicks"] += s.clicks
        c["impr"] += s.impressions
        c["pos_w"] += s.position * max(1, s.impressions)
        if s.clicks >= c["top"][0]:
            c["top"] = (s.clicks, s.query)

    cluster_rows = [
        TopicCluster(
            topic=topic,
            query_count=c["count"],
            clicks=c["clicks"],
            impressions=c["impr"],
            avg_position=round(c["pos_w"] / max(1, c["impr"]), 1),
            top_query=c["top"][1],
        )
        for topic, c in clusters.items()
        if c["count"] >= 2
    ]
    cluster_rows.sort(key=lambda r: (r.clicks, r.impressions), reverse=True)
    cluster_rows = cluster_rows[:12]

    # ── Content ideas — real demand queries, prioritise under-captured ones ──
    ideas: list[ContentIdea] = []
    for s in stats:
        if s.impressions < 30:
            continue
        idea_type = _classify_query(s.query)
        # Score: prioritise high impressions where we rank poorly (unmet demand)
        ideas.append((s, idea_type, s.impressions * (1.0 + min(2.0, (s.position or 1) / 10.0))))
    ideas.sort(key=lambda t: t[2], reverse=True)
    idea_rows = [
        ContentIdea(
            query=s.query, impressions=s.impressions, clicks=s.clicks,
            position=round(s.position, 1), idea_type=itype,
        )
        for s, itype, _ in ideas[:24]
    ]

    return MarketInsights(
        clusters=cluster_rows,
        ideas=idea_rows,
        total_clicks=total_clicks,
        total_impressions=total_impressions,
    )


async def get_health_score(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> HealthScore:
    """A single 0-100 SEO health score from real GSC data, with component breakdown:
    - visibility: impression share already ranking on page 1
    - ctr_efficiency: actual CTR vs the expected CTR for current positions
    - momentum: clicks trend vs the prior period
    - capture: clicks captured vs identified opportunity potential
    """
    result = await db.execute(
        select(GscQueryStat).where(
            GscQueryStat.project_id == project_id,
            GscQueryStat.org_id == org_id,
        )
    )
    stats = list(result.scalars().all())
    ov = await get_overview(project_id, org_id, "28d", db)

    if not stats and ov.clicks == 0:
        return HealthScore(score=0, grade="—", components=[], has_data=False)

    total_impr = sum(s.impressions for s in stats) or 1
    total_clicks = sum(s.clicks for s in stats)

    # Visibility — impression-weighted share on page 1
    page1_impr = sum(s.impressions for s in stats if 0 < (s.position or 0) <= 10.5)
    visibility = page1_impr / total_impr

    # CTR efficiency — actual CTR vs expected CTR at current positions
    expected_ctr = sum(_expected_ctr(s.position or 20) * s.impressions for s in stats) / total_impr
    actual_ctr = total_clicks / total_impr
    ctr_eff = min(1.0, (actual_ctr / expected_ctr) / 1.2) if expected_ctr > 0 else 0.5

    # Momentum — period-over-period clicks change mapped to 0..1 (±50% band)
    momentum = max(0.0, min(1.0, 0.5 + ov.clicks_change / 100))

    # Capture — how much of the identified potential is already banked
    opps = await get_opportunities(project_id, org_id, db)
    denom = ov.clicks + opps.total_potential_clicks
    capture = (ov.clicks / denom) if denom > 0 else 0.5

    score = round(100 * (0.30 * visibility + 0.25 * ctr_eff + 0.25 * momentum + 0.20 * capture))
    grade = "A" if score >= 80 else "B" if score >= 65 else "C" if score >= 45 else "D"

    components = [
        HealthComponent(
            key="visibility", label="Page-1 visibility", score=round(visibility * 100),
            detail=f"{round(visibility * 100)}% of impressions rank on page 1",
        ),
        HealthComponent(
            key="ctr", label="CTR efficiency", score=round(ctr_eff * 100),
            detail=f"CTR {actual_ctr * 100:.1f}% vs {expected_ctr * 100:.1f}% expected for your positions",
        ),
        HealthComponent(
            key="momentum", label="Momentum", score=round(momentum * 100),
            detail=f"Clicks {ov.clicks_change:+.0f}% vs the prior period",
        ),
        HealthComponent(
            key="capture", label="Opportunity capture", score=round(capture * 100),
            detail=f"+{opps.total_potential_clicks:,} potential clicks still on the table",
        ),
    ]
    return HealthScore(score=score, grade=grade, components=components)


async def get_opportunities(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> OpportunitiesResponse:
    """Actionable wins derived from real GSC query stats:
    - striking distance: queries ranking 4-20 (close to page 1) with real impressions
    - CTR wins: page-1 queries under-performing the expected CTR for their position
    """
    result = await db.execute(
        select(GscQueryStat).where(
            GscQueryStat.project_id == project_id,
            GscQueryStat.org_id == org_id,
        )
    )
    stats = result.scalars().all()

    striking: list[OpportunityRow] = []
    ctr_wins: list[OpportunityRow] = []

    for s in stats:
        pos = s.position or 0.0
        if pos <= 0 or s.impressions <= 0:
            continue

        # Striking distance — ranking 4-20, estimate gain from a ~3-position lift
        if 3.5 <= pos <= 20.5 and s.impressions >= 20:
            target = _expected_ctr(max(1, round(pos) - 3))
            gain = max(0, round(s.impressions * (target - s.ctr)))
            if gain > 0:
                striking.append(OpportunityRow(
                    query=s.query, url=s.top_url, clicks=s.clicks, impressions=s.impressions,
                    ctr=s.ctr, position=pos, potential_clicks=gain, kind="striking_distance",
                ))

        # CTR win — page 1 but materially below the position's expected CTR
        if pos <= 10.5 and s.impressions >= 50:
            expected = _expected_ctr(pos)
            if s.ctr < expected * 0.6:
                gain = max(0, round(s.impressions * (expected - s.ctr)))
                if gain > 0:
                    ctr_wins.append(OpportunityRow(
                        query=s.query, url=s.top_url, clicks=s.clicks, impressions=s.impressions,
                        ctr=s.ctr, position=pos, potential_clicks=gain, kind="ctr_win",
                    ))

    striking.sort(key=lambda r: r.potential_clicks, reverse=True)
    ctr_wins.sort(key=lambda r: r.potential_clicks, reverse=True)
    striking = striking[:15]
    ctr_wins = ctr_wins[:15]
    total = sum(r.potential_clicks for r in striking) + sum(r.potential_clicks for r in ctr_wins)

    return OpportunitiesResponse(
        striking_distance=striking,
        ctr_wins=ctr_wins,
        total_potential_clicks=total,
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
    offset_periods: int = 0,
) -> list[TrafficDataPoint]:
    start, end = _parse_range(range_str)
    if offset_periods:
        plen = (end - start).days + 1
        shift = timedelta(days=plen * offset_periods)
        start, end = start - shift, end - shift
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
    """Real rankings straight from the latest GSC sync (every query the site
    actually ranks for), enriched with tracked-keyword metadata when the query
    matches, and a ~7-day position change from ranking history."""
    stat_result = await db.execute(
        select(GscQueryStat).where(
            GscQueryStat.project_id == project_id,
            GscQueryStat.org_id == org_id,
        )
    )
    stats = list(stat_result.scalars().all())

    kw_result = await db.execute(
        select(Keyword).where(
            Keyword.project_id == project_id,
            Keyword.org_id == org_id,
        )
    )
    keywords = kw_result.scalars().all()
    kw_by_text = {kw.keyword.lower(): kw for kw in keywords}

    # Position-change history for tracked keywords: latest row vs a row >= 6 days older
    change_by_kw: dict[uuid.UUID, float] = {}
    if keywords:
        hist_result = await db.execute(
            select(KeywordRanking)
            .where(
                KeywordRanking.project_id == project_id,
                KeywordRanking.org_id == org_id,
                KeywordRanking.date >= date.today() - timedelta(days=21),
            )
            .order_by(KeywordRanking.date.asc())
        )
        by_kw: dict[uuid.UUID, list[KeywordRanking]] = {}
        for r in hist_result.scalars().all():
            by_kw.setdefault(r.keyword_id, []).append(r)
        for kid, hist in by_kw.items():
            latest = hist[-1]
            prior = next((h for h in reversed(hist) if (latest.date - h.date).days >= 6), None)
            if prior is not None:
                change_by_kw[kid] = round(latest.position - prior.position, 1)

    rows: list[RankingRow] = []
    seen: set[str] = set()
    for s in stats:
        seen.add(s.query.lower())
        kw = kw_by_text.get(s.query.lower())
        rows.append(RankingRow(
            keyword_id=kw.id if kw else None,
            keyword=s.query,
            search_volume=kw.search_volume if kw else None,
            intent=(kw.intent.value if kw and kw.intent else None),
            difficulty=kw.difficulty if kw else None,
            current_position=round(s.position, 1) if s.position else None,
            position_change=change_by_kw.get(kw.id) if kw else None,
            clicks=s.clicks,
            impressions=s.impressions,
            tracked=kw is not None,
        ))

    # Tracked keywords the site doesn't rank for yet — keep them visible
    for kw in keywords:
        if kw.keyword.lower() in seen:
            continue
        rows.append(RankingRow(
            keyword_id=kw.id,
            keyword=kw.keyword,
            search_volume=kw.search_volume,
            intent=kw.intent.value if kw.intent else None,
            difficulty=kw.difficulty,
            current_position=None,
            position_change=None,
            tracked=True,
        ))

    if sort_by == "position":
        rows.sort(key=lambda r: r.current_position or 999.0)
    elif sort_by == "clicks":
        rows.sort(key=lambda r: r.clicks, reverse=True)
    elif sort_by == "volume":
        rows.sort(key=lambda r: r.search_volume or 0, reverse=True)
    elif sort_by == "change":
        rows.sort(key=lambda r: r.position_change if r.position_change is not None else 999.0)

    offset = (page - 1) * page_size
    return rows[offset : offset + page_size]


async def get_top_pages(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> list[TopPageRow]:
    """Real GSC page stats from the latest sync."""
    result = await db.execute(
        select(GscPageStat)
        .where(GscPageStat.project_id == project_id, GscPageStat.org_id == org_id)
        .order_by(GscPageStat.clicks.desc())
        .limit(20)
    )
    return [
        TopPageRow(
            url=p.url,
            clicks=p.clicks,
            impressions=p.impressions,
            ctr=p.ctr,
            avg_position=p.position,
        )
        for p in result.scalars().all()
    ]


async def get_top_queries(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> list[TopQueryRow]:
    """Real GSC query stats from the latest sync."""
    result = await db.execute(
        select(GscQueryStat)
        .where(GscQueryStat.project_id == project_id, GscQueryStat.org_id == org_id)
        .order_by(GscQueryStat.clicks.desc())
        .limit(20)
    )
    return [
        TopQueryRow(
            query=q.query,
            clicks=q.clicks,
            impressions=q.impressions,
            ctr=q.ctr,
            avg_position=q.position,
        )
        for q in result.scalars().all()
    ]


async def get_content_performance(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> list[ContentPerformanceRow]:
    art_result = await db.execute(
        select(Article).where(
            Article.project_id == project_id,
            Article.org_id == org_id,
        ).order_by(Article.created_at.desc())
    )
    articles = art_result.scalars().all()

    # Real per-page stats from the latest GSC sync, keyed by exact URL.
    page_result = await db.execute(
        select(GscPageStat).where(
            GscPageStat.project_id == project_id,
            GscPageStat.org_id == org_id,
        )
    )
    page_map = {p.url: p for p in page_result.scalars().all()}

    rows: list[ContentPerformanceRow] = []
    for article in articles:
        published_url: Optional[str] = getattr(article, "published_url", None)
        stat = page_map.get(published_url) if published_url else None
        rows.append(
            ContentPerformanceRow(
                article_id=article.id,
                title=article.title,
                published_url=published_url,
                status=article.status.value,
                clicks=stat.clicks if stat else 0,
                impressions=stat.impressions if stat else 0,
                ctr=stat.ctr if stat else 0.0,
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


_BUYER_INTENT = {"commercial", "comparison"}


async def get_persona_home(project_id, org_id, persona: str, db) -> PersonaHome:
    if persona not in ("creator", "ecommerce", "freelancer", "company"):
        persona = "creator"

    ov = await get_overview(project_id, org_id, "28d", db)

    if persona == "creator":
        traffic = await get_traffic(project_id, org_id, "28d", db)
        market = await get_market_insights(project_id, org_id, db)
        ideas = [i for i in market.ideas if i.idea_type in ("question", "how-to", "list")][:5]
        return PersonaHome(
            persona=persona,
            north_star=NorthStar(
                key="clicks", label="Audience reached (clicks)", value=float(ov.clicks),
                change=ov.clicks_change, trend=[t.clicks for t in traffic],
            ),
            secondary=[
                SecondaryMetric(key="impressions", label="Impressions", value=float(ov.impressions), change=ov.impressions_change),
                SecondaryMetric(key="ctr", label="Avg CTR", value=round(ov.ctr * 100, 2), unit="%", change=ov.ctr_change),
                SecondaryMetric(key="position", label="Avg position", value=round(ov.avg_position, 1), change=ov.position_change, invert_change=True),
            ],
            focus=FocusList(
                title="Content ideas with demand",
                items=[FocusItem(label=i.query, detail=f"{i.impressions:,} impressions · {i.idea_type}") for i in ideas],
            ),
        )

    if persona == "ecommerce":
        rows = (await db.execute(
            select(GscQueryStat).where(GscQueryStat.project_id == project_id, GscQueryStat.org_id == org_id)
        )).scalars().all()
        bi = [r for r in rows if _classify_query(r.query) in _BUYER_INTENT]
        bi_clicks = sum(r.clicks for r in bi)
        bi_impr = sum(r.impressions for r in bi)
        pct = round(bi_clicks / max(1, ov.clicks) * 100)
        opps = await get_opportunities(project_id, org_id, db)
        commercial_opps = [o for o in (opps.striking_distance + opps.ctr_wins) if _classify_query(o.query) in _BUYER_INTENT]
        chosen = (commercial_opps or opps.striking_distance)[:5]
        return PersonaHome(
            persona=persona,
            north_star=NorthStar(
                key="buyer_intent_clicks", label="Buyer-intent clicks", value=float(bi_clicks),
                context=f"{pct}% of your clicks",
            ),
            secondary=[
                SecondaryMetric(key="clicks", label="Total clicks", value=float(ov.clicks), change=ov.clicks_change),
                SecondaryMetric(key="bi_impressions", label="Buyer-intent impressions", value=float(bi_impr)),
                SecondaryMetric(key="striking", label="Striking-distance", value=float(len(opps.striking_distance))),
            ],
            focus=FocusList(
                title="Commercial opportunities",
                items=[FocusItem(label=o.query, detail=f"pos {o.position:.1f} · +{o.potential_clicks} potential") for o in chosen],
            ),
        )

    if persona == "company":
        market = await get_market_insights(project_id, org_id, db)
        traffic = await get_traffic(project_id, org_id, "28d", db)
        opps = await get_opportunities(project_id, org_id, db)
        # Brand topics to reinforce: sizable clusters ranking outside the top 3
        reinforce = sorted(
            [c for c in market.clusters if c.avg_position > 3],
            key=lambda c: (c.query_count, -c.avg_position), reverse=True,
        )[:5]
        return PersonaHome(
            persona=persona,
            north_star=NorthStar(
                key="brand_reach", label="Organic brand reach (impressions)", value=float(market.total_impressions),
                change=ov.impressions_change, trend=[t.impressions for t in traffic],
                context=f"across {len(market.clusters)} brand topics",
            ),
            secondary=[
                SecondaryMetric(key="clicks", label="Clicks", value=float(ov.clicks), change=ov.clicks_change),
                SecondaryMetric(key="ctr", label="Avg CTR", value=round(ov.ctr * 100, 2), unit="%", change=ov.ctr_change),
                SecondaryMetric(key="position", label="Avg position", value=round(ov.avg_position, 1), change=ov.position_change, invert_change=True),
            ],
            focus=FocusList(
                title="Brand topics to reinforce",
                items=[FocusItem(label=c.topic, detail=f"{c.query_count} queries · avg pos {c.avg_position}") for c in reinforce],
            ),
        )

    # freelancer
    market = await get_market_insights(project_id, org_id, db)
    opps = await get_opportunities(project_id, org_id, db)
    clusters = sorted(market.clusters, key=lambda c: c.clicks, reverse=True)[:5]
    return PersonaHome(
        persona=persona,
        north_star=NorthStar(
            key="niche_visibility", label="Niche visibility (impressions)", value=float(market.total_impressions),
            context=f"across {len(market.clusters)} topics",
        ),
        secondary=[
            SecondaryMetric(key="topics", label="Topics mapped", value=float(len(market.clusters))),
            SecondaryMetric(key="striking", label="Striking-distance", value=float(len(opps.striking_distance))),
            SecondaryMetric(key="clicks", label="Total clicks", value=float(ov.clicks), change=ov.clicks_change),
        ],
        focus=FocusList(
            title="Topics to target",
            items=[FocusItem(label=c.topic, detail=f"{c.query_count} queries · avg pos {c.avg_position}") for c in clusters],
        ),
    )


async def get_plan_grounding(project_id, org_id, db) -> PlanGrounding:
    """Ground the Start-a-project plan in the project's real Search Console data.

    Returns per-capability hints (keywords / articles / social / competitors)
    pulled from live opportunities and market clusters, so the plan proposes a
    concrete first move ("start with this query") instead of generic copy.
    Empty when the project has no synced GSC data yet.
    """
    opps = await get_opportunities(project_id, org_id, db)
    market = await get_market_insights(project_id, org_id, db)
    hints: list[PlanHint] = []

    if opps.striking_distance:
        o = opps.striking_distance[0]
        hints.append(PlanHint(key="keywords", query=o.query, a=round(o.position, 1), b=float(o.potential_clicks)))

    demand = [i for i in market.ideas if i.idea_type in ("question", "how-to", "list", "comparison")]
    idea = (demand or market.ideas)
    if idea:
        hints.append(PlanHint(key="articles", query=idea[0].query, a=float(idea[0].impressions)))

    by_reach = sorted(market.clusters, key=lambda c: c.impressions, reverse=True)
    if by_reach:
        hints.append(PlanHint(key="social", query=by_reach[0].topic, a=float(by_reach[0].query_count)))

    # Rivals lead: a sizable topic where the brand ranks poorly (worst position among reached clusters)
    rivals = sorted([c for c in market.clusters if c.avg_position > 5], key=lambda c: c.impressions, reverse=True)
    if rivals:
        hints.append(PlanHint(key="competitors", query=rivals[0].topic, a=round(rivals[0].avg_position, 1)))

    return PlanGrounding(has_data=bool(hints), hints=hints)
