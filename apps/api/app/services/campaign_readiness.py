"""Can this campaign launch, and what breaks if it does.

Three outcomes, and the difference between them is what makes the gate worth
having:

    blocker   launch is refused. Something would silently fail or spend money
              nobody approved.
    warning   launch proceeds. The campaign is weaker than it could be.
    unknown   a check Fennex cannot perform, named with what is missing.

That third category is the one most launch checklists get wrong. The product
spec asks for a "product inventory is low" warning -- but inventory is not among
the fields the Shopify sync stores, so the honest answer is not a green tick. A
checklist that reports "inventory OK" without having looked is worse than no
checklist, because it is trusted.
"""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign, CampaignApproval, CampaignAsset, CampaignChannel
from app.services import campaign_channels as ch

BLOCKER, WARNING, UNKNOWN, OK = "blocker", "warning", "unknown", "ok"


def _item(level: str, key: str, message: str, fix: str = "") -> dict:
    return {"level": level, "key": key, "message": message, "fix": fix}


async def check(campaign: Campaign, db: AsyncSession) -> dict:
    channels = list((await db.execute(select(CampaignChannel).where(
        CampaignChannel.campaign_id == campaign.id))).scalars().all())
    available = await ch.connected_apps(campaign.project_id, campaign.org_id, db)

    asset_counts = dict((await db.execute(
        select(CampaignAsset.channel_id, func.count(CampaignAsset.id))
        .where(CampaignAsset.campaign_id == campaign.id)
        .group_by(CampaignAsset.channel_id)
    )).all())

    pending = list((await db.execute(select(CampaignApproval).where(
        CampaignApproval.campaign_id == campaign.id,
        CampaignApproval.state == "pending"))).scalars().all())

    items: list[dict] = []

    # ── the campaign has somewhere to run ────────────────────────────────────
    if not channels:
        items.append(_item(BLOCKER, "channels", "No channels selected.",
                           "Add at least one channel to the campaign."))
    if not campaign.slug:
        items.append(_item(BLOCKER, "tracking", "No tracking tag.",
                           "A campaign without utm_campaign cannot be measured."))
    else:
        items.append(_item(OK, "tracking", f"Tracking as utm_campaign={campaign.slug}."))

    # ── every channel that spends money must be able to reach its platform ───
    for c in channels:
        cdef = ch.CHANNELS.get(c.channel)
        if cdef is None:
            items.append(_item(WARNING, f"channel:{c.channel}",
                               f"Unknown channel {c.channel}."))
            continue
        executor = ch.executor_for(c.channel, available)
        if executor:
            items.append(_item(OK, f"channel:{c.channel}",
                               f"{cdef.label} will run through {executor}."))
        elif cdef.manual_only:
            # Not a blocker: the content is still produced, it just leaves by
            # hand. Saying so is more useful than refusing the launch.
            items.append(_item(WARNING, f"channel:{c.channel}",
                               f"{cdef.label} has no connector — content is produced "
                               "for you to send yourself.",
                               "Fennex cannot publish to this channel."))
        elif cdef.spends_money:
            names = ", ".join(ch.mcp.CATALOGUE[a].label for a in cdef.connector_apps)
            items.append(_item(BLOCKER, f"channel:{c.channel}",
                               f"{cdef.label} is selected but not connected.",
                               f"Connect {names} to launch this channel."))
        else:
            names = ", ".join(ch.mcp.CATALOGUE[a].label for a in cdef.connector_apps)
            items.append(_item(WARNING, f"channel:{c.channel}",
                               f"{cdef.label} is not connected — its content will be "
                               "prepared but not published.",
                               f"Connect {names} to publish automatically."))

        if not asset_counts.get(c.id):
            items.append(_item(WARNING, f"content:{c.channel}",
                               f"No content written for {cdef.label} yet.",
                               "Generate content in the Content Studio."))

    # ── money ────────────────────────────────────────────────────────────────
    spends = [c for c in channels if (ch.CHANNELS.get(c.channel) or ch.ChannelDef("", "", "")).spends_money]
    if spends and not campaign.budget_amount:
        items.append(_item(BLOCKER, "budget",
                           "Paid channels are selected but no budget is set.",
                           "Set a campaign budget before launching paid channels."))
    if campaign.budget_amount and not campaign.budget_currency:
        items.append(_item(WARNING, "currency", "Budget has no currency."))

    # ── approvals ────────────────────────────────────────────────────────────
    required = sorted({a for c in channels
                       for a in (ch.CHANNELS.get(c.channel).approvals
                                 if ch.CHANNELS.get(c.channel) else [])})
    if required and campaign.approval_state != "approved":
        actions = ", ".join(ch.APPROVAL_LABELS[a].lower() for a in required)
        items.append(_item(BLOCKER, "approval",
                           f"This campaign will {actions}. It has not been approved.",
                           "Send for review, then approve it."))
    elif required:
        items.append(_item(OK, "approval", "Approved."))
    if pending:
        items.append(_item(BLOCKER, "approval_pending",
                           f"{len(pending)} action(s) still waiting for a decision.",
                           "Approve or reject them before launching."))

    # ── schedule ─────────────────────────────────────────────────────────────
    if campaign.starts_on and campaign.ends_on and campaign.ends_on < campaign.starts_on:
        items.append(_item(BLOCKER, "dates", "The end date is before the start date."))
    if not campaign.starts_on:
        items.append(_item(WARNING, "dates", "No start date set.",
                           "Attribution counts orders from the launch date onward."))

    # ── the brief ────────────────────────────────────────────────────────────
    if not campaign.audience:
        items.append(_item(WARNING, "audience", "No audience defined."))
    if not campaign.offer and campaign.objective in ("increase_sales", "clear_inventory", "seasonal"):
        items.append(_item(WARNING, "offer",
                           "This objective usually needs an offer, and none is set."))

    # ── what cannot be checked ───────────────────────────────────────────────
    if campaign.product_ids:
        items.append(_item(UNKNOWN, "inventory",
                           "Stock levels are not checked.",
                           "The product sync stores titles and prices, not inventory, "
                           "so Fennex cannot warn you about running out."))

    blockers = [i for i in items if i["level"] == BLOCKER]
    return {
        "ready": not blockers,
        "blockers": blockers,
        "warnings": [i for i in items if i["level"] == WARNING],
        "unknown": [i for i in items if i["level"] == UNKNOWN],
        "passed": [i for i in items if i["level"] == OK],
        "requiredApprovals": [{"action": a, "label": ch.APPROVAL_LABELS[a]} for a in required],
    }
