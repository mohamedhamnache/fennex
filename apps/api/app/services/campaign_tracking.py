"""Campaign identity and UTM tagging.

Every link a campaign puts into the world carries its slug as `utm_campaign`.
That single tag is what makes the campaign measurable at all: Shopify stores the
landing URL on the order, so the tag comes back attached to real money.

TWO RULES, BOTH LEARNED THE HARD WAY.

The slug is generated once and never changes. Editing it after launch orphans
every order already attributed to the old value -- the revenue does not move to
the new tag, it disappears from both.

The slug is unique within the project. Two campaigns sharing a tag cannot be
told apart afterwards; the orders are simply merged, silently, and no amount of
later analysis can separate them.
"""
from __future__ import annotations

import re
import uuid
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign

_MAX_SLUG = 60


def slugify(text: str) -> str:
    """A URL-safe tag. ASCII-only, because a UTM value with accents or spaces
    gets percent-encoded differently by different platforms and stops matching
    itself."""
    import unicodedata

    normalised = unicodedata.normalize("NFKD", text or "")
    ascii_only = normalised.encode("ascii", "ignore").decode()
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "-", ascii_only).strip("-").lower()
    return cleaned[:_MAX_SLUG].strip("-")


async def unique_slug(project_id: uuid.UUID, base: str, db: AsyncSession,
                      exclude: uuid.UUID | None = None) -> str:
    """`base`, or `base-2`, `base-3`... whichever is free in this project."""
    root = slugify(base) or "campaign"
    taken = set((await db.execute(
        select(Campaign.slug).where(Campaign.project_id == project_id,
                                    Campaign.slug.is_not(None))
    )).scalars().all())
    if exclude is not None:
        current = (await db.execute(
            select(Campaign.slug).where(Campaign.id == exclude))).scalars().first()
        taken.discard(current)
    if root not in taken:
        return root
    for n in range(2, 100):
        candidate = f"{root[:_MAX_SLUG - 4]}-{n}"
        if candidate not in taken:
            return candidate
    return f"{root[:_MAX_SLUG - 9]}-{uuid.uuid4().hex[:8]}"


def tag_url(url: str, *, campaign: str, source: str, medium: str,
            content: str = "", term: str = "") -> str:
    """Add UTM parameters to a URL without disturbing what is already there.

    Existing parameters are preserved and existing UTM values are overwritten:
    a link pasted from somewhere else usually carries that source's tags, and
    leaving them would attribute this campaign's orders to that one.
    """
    if not url:
        return url
    parsed = urlparse(url if "//" in url else f"https://{url}")
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    params.update({k: v for k, v in {
        "utm_source": source, "utm_medium": medium, "utm_campaign": campaign,
        "utm_content": content, "utm_term": term,
    }.items() if v})
    return urlunparse(parsed._replace(query=urlencode(params)))


def plan_for(campaign: Campaign, channels: list, base_url: str = "") -> dict:
    """The campaign's tracking plan: one tagged link per channel.

    `utm_content` is the channel row's id rather than a label, so two Instagram
    posts in the same campaign stay distinguishable in the revenue split. A
    label would collide the moment someone reuses a channel.
    """
    from app.services.campaign_channels import CHANNELS

    links = []
    for ch in channels:
        cdef = CHANNELS.get(ch.channel)
        if cdef is None:
            continue
        source = cdef.utm_source or ch.channel
        links.append({
            "channel": ch.channel,
            "channel_id": str(ch.id),
            "utm_source": source,
            "utm_medium": cdef.utm_medium,
            "utm_campaign": campaign.slug,
            "utm_content": str(ch.id)[:8],
            "url": tag_url(base_url, campaign=campaign.slug or "", source=source,
                           medium=cdef.utm_medium, content=str(ch.id)[:8]) if base_url else "",
        })
    return {"utm_campaign": campaign.slug, "links": links,
            "base_url": base_url,
            # Said plainly because it is the one thing a merchant must do by
            # hand for any of this to work.
            "note": "Every link in this campaign must carry utm_campaign="
                    f"{campaign.slug}. Untagged links produce orders Fennex "
                    "cannot attribute to this campaign."}
