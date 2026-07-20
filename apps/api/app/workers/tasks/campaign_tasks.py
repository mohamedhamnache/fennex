"""Campaign orchestrator: run a planned campaign's steps in order, chaining outputs."""
import logging
import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.calendar_entry import CalendarEntry
from app.models.campaign import Campaign, CampaignStep
from app.services.calendar_service import create_entry as create_calendar_entry
from app.services.recommendation_service import create_recommendation

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _autotrack_campaign(campaign, steps, db) -> None:
    """On completion, hand the campaign's angle to Zerda's closed-loop tracking."""
    try:
        keyword = None
        rationale = ""
        for s in steps:
            st = s.structured or {}
            if s.status == "completed" and st.get("keyword"):
                keyword = str(st["keyword"])
                rationale = str(st.get("rationale", ""))
                break
        if not keyword:
            return
        title = f"Campaign: {campaign.goal[:80]}"
        from app.models.recommendation import Recommendation
        from sqlalchemy import select as _select
        existing = (await db.execute(_select(Recommendation).where(
            Recommendation.project_id == campaign.project_id,
            Recommendation.anchor_query == keyword,
            Recommendation.title == title,
        ))).scalars().first()
        if existing is not None:
            return
        await create_recommendation(
            campaign.project_id, campaign.org_id,
            {"source": "agent", "source_agent": "zerda", "title": title,
             "detail": (campaign.goal + ("\n\nAngle: " + rationale if rationale else ""))[:2000],
             "anchor_query": keyword},
            db,
        )
    except Exception:
        logger.exception("campaign auto-track failed: %s", campaign.id)


def _ship_dates(week_of, today, count: int) -> list[str]:
    """ISO datetimes at 09:00 UTC on distinct weekdays: the remaining weekdays of
    week_of's week strictly after today, rolling into early next week if exhausted."""
    out: list[str] = []
    d = max(week_of, today) + timedelta(days=1)
    while len(out) < count:
        if d.weekday() < 5:  # Mon-Fri
            out.append(f"{d.isoformat()}T09:00:00+00:00")
        d += timedelta(days=1)
    return out


async def _ship_autopilot_artifacts(campaign, steps, db) -> None:
    """Schedule a completed autopilot campaign's artifacts on the Content Calendar
    as planned entries (the calendar's arm/publish gate is unchanged). Isolated:
    failures are logged and never affect the campaign."""
    try:
        if campaign.source != "autopilot" or campaign.status != "completed":
            return
        targets: list[tuple[str, str]] = []  # (content_type, content_id)
        for s in steps:
            if s.status != "completed":
                continue
            if s.artifact_type == "article" and s.artifact_ids:
                targets.append(("article", str(s.artifact_ids[0])))
            elif s.artifact_type == "image" and (s.structured or {}).get("image_id"):
                targets.append(("banner", str(s.structured["image_id"])))
        if not targets:
            return
        dates = _ship_dates(campaign.week_of or date.today(), date.today(), len(targets))
        for (ctype, cid), when in zip(targets, dates):
            existing = (await db.execute(select(CalendarEntry).where(
                CalendarEntry.project_id == campaign.project_id,
                CalendarEntry.content_type == ctype,
                CalendarEntry.content_id == uuid.UUID(cid),
            ))).scalars().first()
            if existing is not None:
                continue
            await create_calendar_entry(campaign.project_id, campaign.org_id,
                                        {"content_type": ctype, "content_id": cid,
                                         "scheduled_at": when}, db)
    except Exception:
        logger.exception("autopilot ship-to-calendar failed: %s", campaign.id)


async def execute_campaign(campaign_id, db_factory=None) -> None:
    factory = db_factory or async_session_factory
    async with factory() as db:
        campaign = await db.get(Campaign, campaign_id)
        if campaign is None:
            return
        from app.services.agents.director import run_campaign as run_agent_campaign
        try:
            await run_agent_campaign(campaign, db)
        except Exception:
            logger.exception("campaign execution crashed: %s", campaign_id)
            await db.rollback()
            campaign = await db.get(Campaign, campaign_id)
            if campaign is not None:
                campaign.status = "failed"
                await db.commit()
            return

        # Preserve post-completion autopilot hooks on the freshly-produced steps.
        await db.refresh(campaign)
        if campaign.status == "completed":
            steps = (await db.execute(select(CampaignStep).where(
                CampaignStep.campaign_id == campaign_id).order_by(CampaignStep.order))).scalars().all()
            await _autotrack_campaign(campaign, steps, db)
            await _ship_autopilot_artifacts(campaign, steps, db)


async def run_campaign(ctx, campaign_id: str) -> None:
    await execute_campaign(uuid.UUID(campaign_id))
