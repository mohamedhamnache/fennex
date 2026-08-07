"""One strategy, many channels: the content studio.

WHY EVERY CHANNEL IS GENERATED FROM THE SAME BLOCK. A campaign whose email says
"20% off" and whose Instagram caption says "free shipping" is not a campaign, it
is two campaigns with one name. So the offer, audience, angle and CTA are
assembled once, into a brief that every channel's prompt is built from, and the
model is told that the offer is a fact it may not restate in its own terms.

VARIATIONS ARE ROWS, NOT A LIST. Three headlines returned as a JSON array look
the same on screen as three headline rows, until you want to A/B one of them,
approve one of them, or attribute revenue to one of them. Then only rows work.

The cheap band does this work. Ad copy and subject lines are structured, short,
and heavily constrained by the brief -- the failure mode of a cheap model here
is malformed JSON, which the cascade validator catches for free, not weak taste.
"""
from __future__ import annotations

import json
import logging
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign, CampaignAsset, CampaignChannel
from app.services import campaign_channels as ch
from app.services import campaign_team
from app.services.agents.cascade import call_with_cascade, validators
from app.services.llm_service import get_org_llm_keys, project_locale

logger = logging.getLogger(__name__)
_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")

# How many variants of each kind. Three is the number the merchant can actually
# compare; six is a wall of text nobody reads.
VARIANTS = ("A", "B", "C")

KIND_LABELS = {
    "headline": "headline (max 60 characters)",
    "hook": "opening hook, the first line that stops the scroll",
    "primary_text": "primary body text",
    "cta": "call to action (max 4 words)",
    "subject": "email subject line (max 60 characters)",
    "ad_concept": "ad concept: what is shown, and why it works",
    "post": "full social post, including hashtags where the channel expects them",
    "image": "image prompt describing the visual to generate",
}

# The refinements the UI offers. Each is a single instruction appended to the
# rewrite prompt -- kept here rather than in the frontend so the wording that
# reaches the model is reviewable in one place.
REFINEMENTS = {
    "improve": "Make it stronger and more specific. Same length.",
    "shorten": "Cut it to the shortest version that keeps the point.",
    "premium": "Raise the register. Confident and understated, never loud. No exclamation marks.",
    "emotional": "Lead with what the reader feels, not what the product is.",
    "direct": "Say the offer plainly in the first four words. Remove every hedge.",
    "playful": "Lighter and warmer, without becoming silly.",
}


async def _brand(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession,
                 *, visual: bool = False) -> str:
    """The brand's own voice, so every channel sounds like the same company.

    Same BrandDNA the employees use, not a second description that would drift
    from it. `visual=True` adds the palette and imagery rules, which only the
    image kinds need.
    """
    try:
        from app.employees import brand_dna
        dna = await brand_dna.build(project_id, org_id, db)
        return dna.as_prompt(visual=visual) or ""
    except Exception:  # noqa: BLE001 - a project without a brand kit is normal
        logger.exception("brand DNA unavailable for %s", project_id)
        return ""


def campaign_brief(campaign: Campaign) -> str:
    """The single source every channel's copy is written from."""
    offer = campaign.offer or {}
    audience = campaign.audience or {}
    lines = [
        f"CAMPAIGN: {campaign.name or campaign.goal[:80]}",
        f"OBJECTIVE: {campaign.objective or 'not set'}",
        f"WHAT IT IS FOR: {campaign.goal}",
    ]
    if campaign.brief_summary:
        lines.append(f"STRATEGY: {campaign.brief_summary}")
    if audience.get("label") or audience.get("definition"):
        lines.append(f"AUDIENCE: {audience.get('label', '')} — {audience.get('definition', '')}")
    if offer.get("description") or offer.get("value"):
        # Stated as a fact rather than a suggestion: an offer the copy restates
        # in its own words is an offer the merchant did not agree to.
        lines.append(f"OFFER (state it exactly, never reword the terms): "
                     f"{offer.get('value', '')} — {offer.get('description', '')}")
    else:
        lines.append("OFFER: none. Do not invent a discount, a deadline or free shipping.")
    if campaign.starts_on:
        lines.append(f"RUNS: {campaign.starts_on} to {campaign.ends_on or 'open-ended'}")
    return "\n".join(lines)


_SYSTEM = """You write campaign copy for an ecommerce brand.

RULES THAT OVERRIDE EVERY INSTINCT:
- The offer is a fact. Never invent a discount, a percentage, a deadline, free
  shipping, a gift, or scarcity that is not in the brief.
- Never invent a product name, a price, a review, a statistic, or a customer
  count. If you need a detail you were not given, write around it.
- Every variant must be genuinely different -- a different angle, not the same
  sentence reordered. Three near-identical options are worth one option.
- Match the brand voice given. If none is given, write plainly.

Respond with ONLY a JSON object: {"<kind>": ["variant A", "variant B", "variant C"]}
using exactly the kinds requested."""


async def generate(campaign: Campaign, channel: CampaignChannel, kinds: list[str],
                   db: AsyncSession, *, angle: str = "") -> list[CampaignAsset]:
    """Write every requested kind for one channel, three variants each."""
    keys = await get_org_llm_keys(campaign.org_id, db)
    if not keys:
        raise ValueError("No AI key configured. Add an Anthropic or OpenAI key in Settings.")

    cdef = ch.CHANNELS.get(channel.channel)
    wanted = [k for k in kinds if k in KIND_LABELS] or (cdef.content_kinds if cdef else [])
    if not wanted:
        return []

    # Image prompts need the visual half of the brand DNA; copy does not.
    brand = await _brand(campaign.project_id, campaign.org_id, db,
                         visual=any(k == "image" for k in wanted))

    # The agent that owns this channel writes it. A campaign is work produced by
    # a team, so the copy carries that employee's brief rather than coming from
    # an anonymous generator -- and the asset records who wrote it.
    author = campaign_team.owner_for(channel.channel, (channel.config or {}).get("owner"))
    voice = ""
    if author:
        from app.employees import registry
        employee = registry.get(author)
        if employee is not None:
            voice = (f"\nYOU ARE {employee.name.upper()}, {employee.role}. Write as that "
                     "specialist would: lead with what you are best at, and stay inside "
                     "the campaign brief.\n")
    asked = "\n".join(f"- {k}: {KIND_LABELS[k]}" for k in wanted)
    user = (f"{campaign_brief(campaign)}\n\n"
            f"CHANNEL: {cdef.label if cdef else channel.channel}"
            f"{f' ({channel.role})' if channel.role else ''}\n"
            + (f"ANGLE FOR THIS CHANNEL: {angle}\n" if angle else "")
            + voice
            + (f"\nBRAND VOICE:\n{brand}\n" if brand else "")
            + f"\nWRITE {len(VARIANTS)} VARIANTS OF EACH:\n{asked}")

    raw = await call_with_cascade(
        keys=keys, feature="campaign_content", system_prompt=_SYSTEM, user_prompt=user,
        tier="balanced", weight="light",
        locale=await project_locale(campaign.project_id, db),
        validate=validators.json_object(tuple(wanted[:1])),
        meter={"db": db, "org_id": campaign.org_id, "project_id": campaign.project_id,
               "feature": "campaign_content"},
    )
    try:
        data = json.loads(_FENCE.sub("", raw or ""))
    except ValueError:
        raise ValueError("The copy could not be generated. Try again.")

    created: list[CampaignAsset] = []
    for kind in wanted:
        values = data.get(kind)
        if isinstance(values, str):
            values = [values]
        if not isinstance(values, list):
            continue
        for variant, body in zip(VARIANTS, values):
            text = str(body).strip()
            if not text:
                continue
            meta = {"by": author} if author else {}
            if angle:
                meta["angle"] = angle
            asset = CampaignAsset(campaign_id=campaign.id, channel_id=channel.id,
                                  kind=kind, variant=variant, body=text[:4000],
                                  meta=meta or None)
            db.add(asset)
            created.append(asset)
    await db.flush()
    return created


async def refine(asset: CampaignAsset, campaign: Campaign, action: str,
                 db: AsyncSession, *, target_locale: str = "") -> str:
    """Rewrite one variant. Returns the new text; the caller decides where it goes.

    Translation is the one refinement that takes an argument, and it is handled
    here rather than as a separate call so a translated variant inherits the same
    offer-is-a-fact constraint. A translated discount that drifts is still a
    discount the merchant did not agree to.
    """
    keys = await get_org_llm_keys(campaign.org_id, db)
    if not keys:
        raise ValueError("No AI key configured.")

    if action == "translate":
        if not target_locale:
            raise ValueError("Translation needs a target language.")
        instruction = (f"Translate into {target_locale}. Keep the offer terms, numbers "
                       "and any product name exactly as they are.")
    else:
        instruction = REFINEMENTS.get(action)
        if instruction is None:
            raise ValueError(f"Unknown refinement {action!r}.")

    user = (f"{campaign_brief(campaign)}\n\n"
            f"CURRENT {asset.kind.upper()}:\n{asset.body}\n\n"
            f"REWRITE IT: {instruction}\n\n"
            "Respond with ONLY the rewritten text, nothing else.")

    text = await call_with_cascade(
        keys=keys, feature="campaign_content",
        system_prompt=_SYSTEM.split("Respond with ONLY")[0].strip(),
        user_prompt=user, tier="balanced", weight="light",
        locale=target_locale or await project_locale(campaign.project_id, db),
        validate=validators.non_empty,
        meter={"db": db, "org_id": campaign.org_id, "project_id": campaign.project_id,
               "feature": "campaign_content"},
    )
    return _FENCE.sub("", (text or "").strip()).strip('"').strip()


async def coverage(campaign_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """What each channel still needs written.

    Drives the readiness view and the studio's empty states, from one query
    rather than each screen counting for itself.
    """
    channels = list((await db.execute(select(CampaignChannel).where(
        CampaignChannel.campaign_id == campaign_id))).scalars().all())
    assets = list((await db.execute(select(CampaignAsset).where(
        CampaignAsset.campaign_id == campaign_id))).scalars().all())

    out = []
    for c in channels:
        cdef = ch.CHANNELS.get(c.channel)
        expected = set(cdef.content_kinds) if cdef else set()
        have = {a.kind for a in assets if a.channel_id == c.id}
        out.append({
            "channel_id": str(c.id), "channel": c.channel,
            "label": cdef.label if cdef else c.channel,
            "expected": sorted(expected), "written": sorted(have & expected),
            "missing": sorted(expected - have),
            "assets": len([a for a in assets if a.channel_id == c.id]),
        })
    return out
