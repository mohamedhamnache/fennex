"""Autopilot: deterministic Monday planner — builds a persona-shaped Campaign
from the project's real GSC opportunities. Zero LLM cost; execution happens
only when the user launches the campaign (existing orchestrator)."""
import logging
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analytics import GscConnection
from app.models.campaign import Campaign, CampaignStep
from app.services.analytics_service import get_opportunities

logger = logging.getLogger(__name__)


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


# Persona -> ordered (agent, action, brief_kind). brief_kind flavors the templated brief.
_SHAPES: dict[str, list[tuple[str, str, str]]] = {
    "creator": [
        ("zerda", "zerda.pick_angle", "angle"),
        ("dune", "dune.write_article", "article"),
        ("sirocco", "sirocco.generate_visual", "visual"),
        ("nomad", "nomad.social_posts", "social"),
    ],
    "ecommerce": [
        ("zerda", "zerda.pick_angle", "angle"),
        ("dune", "dune.write_article", "buyer_article"),
        ("sirocco", "sirocco.generate_visual", "product_visual"),
    ],
    "freelancer": [
        ("zerda", "zerda.pick_angle", "angle"),
        ("dune", "dune.write_article", "authority_article"),
        ("nomad", "nomad.social_posts", "social"),
    ],
}

_BRIEFS: dict[str, dict] = {
    "angle": {},
    "article": {},
    "buyer_article": {"tone": "commercial", "focus": "buyer intent"},
    "authority_article": {"tone": "expert", "focus": "authority piece"},
    "product_visual": {"style": "product"},
    "visual": {},
    "social": {"platform": "linkedin"},
}


async def generate_weekly_plan(project, db: AsyncSession) -> Campaign | None:
    """Create this week's autopilot Campaign for the project, or None.

    None when: autopilot disabled, no active GSC connection, no opportunities,
    or a plan for this week already exists (idempotent). A stale *planned*
    autopilot plan from a past week is cancelled and replaced.
    """
    if not project.autopilot_enabled:
        return None

    gsc = (await db.execute(select(GscConnection).where(
        GscConnection.project_id == project.id,
        GscConnection.is_active.is_(True),
    ))).scalars().first()
    if gsc is None:
        return None

    week = monday_of(date.today())
    existing = (await db.execute(select(Campaign).where(
        Campaign.project_id == project.id,
        Campaign.source == "autopilot",
        Campaign.week_of == week,
    ))).scalars().first()
    if existing is not None:
        return None

    # Supersede stale unlaunched plans from previous weeks.
    stale = (await db.execute(select(Campaign).where(
        Campaign.project_id == project.id,
        Campaign.source == "autopilot",
        Campaign.status == "planned",
        Campaign.week_of < week,
    ))).scalars().all()
    for s in stale:
        s.status = "cancelled"

    opps = await get_opportunities(project.id, project.org_id, db)
    ranked = list(opps.striking_distance) + list(opps.ctr_wins)
    if not ranked:
        await db.commit()  # persist stale-cancellations even without a new plan
        return None
    top = ranked[0]

    persona = project.persona or "creator"
    shape = _SHAPES.get(persona, _SHAPES["creator"])
    why = (
        f"'{top.query}' is at position {top.position:.1f} with {top.impressions} "
        f"impressions - +{top.potential_clicks} potential clicks this month."
    )
    campaign = Campaign(
        org_id=project.org_id, project_id=project.id,
        goal=f"Week of {week.isoformat()}: win '{top.query}'",
        persona=persona, status="planned", source="autopilot", week_of=week,
        director_summary=(
            f"Autopilot picked the top opportunity from your real search data: {why}"
        ),
    )
    db.add(campaign)
    await db.flush()
    for i, (agent, action, brief_kind) in enumerate(shape):
        brief = dict(_BRIEFS[brief_kind])
        brief["keyword"] = top.query
        db.add(CampaignStep(
            campaign_id=campaign.id, order=i, agent=agent, action=action,
            brief=brief, why=why,
        ))
    await db.commit()
    await db.refresh(campaign)
    logger.info("autopilot: planned week %s for project %s", week, project.id)
    return campaign
