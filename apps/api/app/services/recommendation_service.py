"""Closed-loop recommendation tracking — persistence, lifecycle, measurement, matching."""
import uuid
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics import GscQueryStat
from app.models.article import Article, ArticleStatus
from app.models.recommendation import Recommendation
from app.models.social import SocialPost, SocialPostStatus
from app.services.recommendation_scoring import compute_impact, matches_query, MEASUREMENT_WINDOW_DAYS


async def _query_metrics(project_id, org_id, query: str, db: AsyncSession) -> dict | None:
    row = (await db.execute(
        select(GscQueryStat).where(
            GscQueryStat.project_id == project_id,
            GscQueryStat.org_id == org_id,
            GscQueryStat.query == query,
        )
    )).scalars().first()
    if row is None:
        return None
    return {"clicks": row.clicks, "impressions": row.impressions, "ctr": row.ctr, "position": row.position}


async def create_recommendation(project_id, org_id, data: dict, db: AsyncSession) -> Recommendation:
    anchor = (data.get("anchor_query") or "").strip() or None
    baseline = None
    if anchor:
        metrics = await _query_metrics(project_id, org_id, anchor, db)
        if metrics is not None:
            baseline = {**metrics, "captured_at": date.today().isoformat()}
    rec = Recommendation(
        org_id=org_id, project_id=project_id,
        source=data["source"], source_agent=data.get("source_agent"),
        kind=data.get("kind"), title=data["title"][:500], detail=data.get("detail"),
        anchor_query=anchor, anchor_url=data.get("anchor_url"),
        status="tracking", baseline=baseline,
    )
    db.add(rec)
    await db.commit()
    await db.refresh(rec)
    return rec


async def list_recommendations(project_id, org_id, db: AsyncSession, status: str | None = None) -> list[Recommendation]:
    q = select(Recommendation).where(
        Recommendation.project_id == project_id, Recommendation.org_id == org_id,
    )
    if status:
        q = q.where(Recommendation.status == status)
    q = q.order_by(Recommendation.created_at.desc())
    return list((await db.execute(q)).scalars().all())


async def transition(rec_id, org_id, status: str, db: AsyncSession) -> Recommendation | None:
    rec = (await db.execute(
        select(Recommendation).where(Recommendation.id == rec_id, Recommendation.org_id == org_id)
    )).scalars().first()
    if rec is None:
        return None
    rec.status = status
    if status == "done":
        rec.done_at = date.today().isoformat()
        if rec.anchor_query and rec.outcome is None:
            rec.outcome = "pending"
    await db.commit()
    await db.refresh(rec)
    return rec


async def measure(project_id, org_id, db: AsyncSession, today: date | None = None) -> int:
    today = today or date.today()
    recs = (await db.execute(
        select(Recommendation).where(
            Recommendation.project_id == project_id,
            Recommendation.org_id == org_id,
            Recommendation.status == "done",
            Recommendation.anchor_query.is_not(None),
            Recommendation.baseline.is_not(None),
        )
    )).scalars().all()
    measured = 0
    for rec in recs:
        if not rec.done_at:
            continue
        due = date.fromisoformat(rec.done_at) + timedelta(days=MEASUREMENT_WINDOW_DAYS)
        if today < due:
            continue
        latest = await _query_metrics(project_id, org_id, rec.anchor_query, db)
        if latest is None:
            continue
        score, verdict = compute_impact(rec.baseline, latest)
        rec.latest = latest
        rec.impact_score = score
        rec.outcome = verdict
        rec.measured_at = today.isoformat()
        measured += 1
    if measured:
        await db.commit()
    return measured


async def run_matching(project_id, org_id, db: AsyncSession) -> int:
    recs = (await db.execute(
        select(Recommendation).where(
            Recommendation.project_id == project_id,
            Recommendation.org_id == org_id,
            Recommendation.status == "tracking",
            Recommendation.anchor_query.is_not(None),
            Recommendation.detected_content.is_(None),
        )
    )).scalars().all()
    if not recs:
        return 0

    articles = (await db.execute(
        select(Article).where(
            Article.project_id == project_id, Article.org_id == org_id,
            Article.status == ArticleStatus.published,
        )
    )).scalars().all()
    posts = (await db.execute(
        select(SocialPost).where(
            SocialPost.project_id == project_id, SocialPost.org_id == org_id,
            SocialPost.status == SocialPostStatus.published,
        )
    )).scalars().all()

    detected = 0
    for rec in recs:
        hits = []
        for a in articles:
            text = f"{a.title} {a.target_keyword or ''}"
            if matches_query(rec.anchor_query, text):
                hits.append({"type": "article", "id": str(a.id), "title": a.title, "matched_on": "title"})
        for p in posts:
            text = f"{p.content} {' '.join(p.hashtags or [])}"
            if matches_query(rec.anchor_query, text):
                hits.append({"type": "social", "id": str(p.id), "title": p.content[:80], "matched_on": "content"})
        if hits:
            rec.detected_content = hits
            detected += 1
    if detected:
        await db.commit()
    return detected


async def summarize(project_id, org_id, db: AsyncSession) -> dict:
    recs = (await db.execute(
        select(Recommendation).where(
            Recommendation.project_id == project_id, Recommendation.org_id == org_id,
            Recommendation.status == "done",
        )
    )).scalars().all()
    won = [r for r in recs if r.outcome == "won"]
    measuring = [r for r in recs if r.outcome == "pending"]
    won_clicks = sum(
        int((r.latest or {}).get("clicks", 0)) - int((r.baseline or {}).get("clicks", 0))
        for r in won
    )
    return {"acted": len(recs), "won": len(won), "measuring": len(measuring), "won_clicks": won_clicks}
