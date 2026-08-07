"""Who is working on this campaign.

A campaign is a piece of work produced by a combination of agents -- not an ad
buy with a budget attached. The channels, the money and the attribution exist to
give that work a target and a way to know whether it landed; the agents are the
thing doing it.

So every part of a campaign has an OWNER from the roster. The strategy assigns
one per channel and per timeline step, content is written by the agent that owns
the channel rather than by an anonymous generator, and every asset records who
produced it. That is what makes the campaign page answer "who is doing what" --
the question a person actually has when they delegate work to a team.

OWNERSHIP IS VALIDATED, NEVER INVENTED. An owner that is not in the live roster
is dropped rather than displayed: a campaign showing work assigned to an agent
that does not exist is worse than one showing no assignment at all.
"""
from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.employees import registry
from app.models.campaign import CampaignAsset, CampaignChannel, CampaignTask

# Which agent is the natural owner of each channel's work. Used when the
# strategy does not assign one, so a channel is never ownerless.
#
# These are defaults, not rules: the strategy may assign differently and the
# merchant may reassign. Derived from what each employee actually produces --
# Souk owns the store because it is the ecommerce operator, Mirage owns visual
# channels, Dune owns written ones.
DEFAULT_OWNER = {
    "email": "dune",
    "sms": "dune",
    "push": "dune",
    "blog": "dune",
    "landing_page": "dune",
    "instagram": "mirage",
    "facebook": "sirocco",
    "tiktok": "sirocco",
    "pinterest": "mirage",
    "meta_ads": "sirocco",
    "google_ads": "zerda",
    "tiktok_ads": "sirocco",
    "shopify": "souk",
}


def valid_owner(employee_id: str | None) -> str | None:
    """The id if it names a live employee, else None."""
    if not employee_id:
        return None
    return employee_id if registry.get(employee_id) is not None else None


def owner_for(channel: str, assigned: str | None = None) -> str | None:
    """Who owns this channel's work: the assignment, the default, or nobody."""
    return valid_owner(assigned) or valid_owner(DEFAULT_OWNER.get(channel))


def _employee_card(employee_id: str) -> dict | None:
    e = registry.get(employee_id)
    if e is None:
        return None
    return {"id": e.id, "name": e.name, "role": e.role,
            "icon": getattr(e, "icon", ""), "department": getattr(e, "department", "")}


async def build(campaign_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """The team, with what each agent owns and what it has produced so far.

    Built from the campaign's own rows rather than from the strategy's text, so
    it stays true after the merchant edits channels or reassigns a step.
    """
    channels = list((await db.execute(select(CampaignChannel).where(
        CampaignChannel.campaign_id == campaign_id))).scalars().all())
    tasks = list((await db.execute(select(CampaignTask).where(
        CampaignTask.campaign_id == campaign_id))).scalars().all())
    assets = list((await db.execute(select(CampaignAsset).where(
        CampaignAsset.campaign_id == campaign_id))).scalars().all())

    by_channel_id = {c.id: c for c in channels}
    team: dict[str, dict] = {}

    def slot(employee_id: str) -> dict | None:
        if employee_id not in team:
            card = _employee_card(employee_id)
            if card is None:
                return None
            team[employee_id] = {**card, "channels": [], "tasks": [], "produced": 0}
        return team[employee_id]

    for c in channels:
        owner = owner_for(c.channel, (c.config or {}).get("owner"))
        if owner and (entry := slot(owner)) is not None:
            entry["channels"].append(c.channel)

    for t in tasks:
        owner = valid_owner(t.owner)
        if owner and (entry := slot(owner)) is not None:
            entry["tasks"].append({"day_offset": t.day_offset, "title": t.title,
                                   "status": t.status})

    for a in assets:
        # Who actually wrote it, recorded at generation time. Falls back to the
        # channel's owner for assets written before authorship was tracked.
        by = valid_owner((a.meta or {}).get("by"))
        if by is None and a.channel_id in by_channel_id:
            row = by_channel_id[a.channel_id]
            by = owner_for(row.channel, (row.config or {}).get("owner"))
        if by and (entry := slot(by)) is not None:
            entry["produced"] += 1

    # Most involved first: the person reading this wants to know who is carrying
    # the campaign, not who appears first alphabetically.
    return sorted(team.values(),
                  key=lambda e: (len(e["channels"]) + len(e["tasks"]), e["produced"]),
                  reverse=True)


def roster_prompt() -> str:
    """The team a strategy may assign work to, for the planner's prompt."""
    lines = []
    for e in registry.all_employees():
        produces = ", ".join((e.produces_for or [])[:4]) or "general work"
        lines.append(f"  {e.id} ({e.name}, {e.role}): {produces}")
    return "\n".join(lines)
