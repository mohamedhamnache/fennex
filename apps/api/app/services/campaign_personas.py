"""Not every project sells products.

A project carries a persona -- creator, freelancer, company, ecommerce -- and it
changes what a campaign IS, not merely how it is worded. Offering "clear
inventory" to a creator, or measuring a freelancer's outreach campaign in
attributed revenue, is not a cosmetic mismatch: it is a product that does not
understand what the person does.

So persona decides four things, and each of them is a real branch:

    objectives   what you can be trying to achieve
    channels     a creator has no store; a freelancer has no ad account to fill
    templates    Black Friday is not a thing for a consultancy
    outcome      what "did it work" even means

WHAT THIS DELIBERATELY DOES NOT DO. It never invents an outcome. A creator
campaign has no attributed revenue because there are no orders to attribute --
so it reports content performance and says plainly that revenue is not
measurable here, rather than displaying a confident 0.00 that reads as failure.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# The personas a project can carry. Anything unknown falls back to `creator`,
# which is the least presumptuous: it assumes an audience and content, not a
# store, a sales team or an ad budget.
DEFAULT_PERSONA = "creator"


@dataclass(frozen=True)
class PersonaProfile:
    key: str
    label: str
    # Objectives, in the order they should be offered.
    objectives: list[str] = field(default_factory=list)
    # Channels that make sense. A store channel for someone with no store is a
    # dead option that makes the whole list look untrustworthy.
    channels: list[str] = field(default_factory=list)
    templates: list[str] = field(default_factory=list)
    # What success is measured in. `revenue` requires synced orders; `content`
    # means clicks, impressions and published work.
    outcome: str = "content"
    # One line the strategy engine is given, so the plan is about their job.
    brief: str = ""


PROFILES: dict[str, PersonaProfile] = {p.key: p for p in [
    PersonaProfile(
        "creator", "Creator",
        objectives=["grow_audience", "launch_content", "brand_awareness",
                    "promote_offer", "repeat_engagement", "seasonal", "custom"],
        channels=["email", "instagram", "tiktok", "facebook", "pinterest",
                  "blog", "landing_page", "push"],
        templates=["product_launch", "new_collection", "product_education",
                   "brand_awareness", "valentines", "christmas"],
        outcome="content",
        brief="An independent creator building an audience around what they make. "
              "Judge campaigns on reach, subscribers and published work, not on orders.",
    ),
    PersonaProfile(
        "ecommerce", "Online store",
        objectives=["launch_product", "increase_sales", "clear_inventory",
                    "acquire_customers", "retarget_customers", "repeat_purchase",
                    "promote_collection", "seasonal", "brand_awareness", "custom"],
        channels=["email", "sms", "instagram", "facebook", "tiktok", "pinterest",
                  "meta_ads", "google_ads", "tiktok_ads", "blog", "landing_page",
                  "shopify", "push"],
        templates=["product_launch", "black_friday", "summer_sale", "christmas",
                   "valentines", "flash_sale", "new_collection", "back_in_stock",
                   "clearance", "winback", "abandoned_cart", "vip", "retargeting",
                   "product_education", "brand_awareness"],
        outcome="revenue",
        brief="An online store. Judge campaigns on attributed revenue and orders.",
    ),
    PersonaProfile(
        "freelancer", "Freelancer",
        objectives=["acquire_clients", "authority", "brand_awareness",
                    "promote_offer", "repeat_engagement", "custom"],
        channels=["email", "instagram", "blog", "landing_page"],
        templates=["product_education", "brand_awareness", "new_collection"],
        outcome="pipeline",
        brief="An independent professional selling their own services. Campaigns "
              "exist to start conversations with the right clients, not to move "
              "units. Judge them on qualified enquiries and published authority "
              "work, never on order volume.",
    ),
    PersonaProfile(
        "company", "Company",
        objectives=["generate_leads", "launch_product", "brand_awareness",
                    "authority", "acquire_customers", "seasonal", "custom"],
        channels=["email", "instagram", "facebook", "meta_ads", "google_ads",
                  "blog", "landing_page"],
        templates=["product_launch", "product_education", "brand_awareness",
                   "new_collection", "retargeting"],
        outcome="pipeline",
        brief="A business selling to other businesses or to a considered-purchase "
              "audience. Judge campaigns on qualified leads and reach, not on "
              "same-day orders.",
    ),
]}

# Objective -> what the strategy should optimise for. Shared across personas
# where the meaning is the same; the persona decides which are OFFERED.
OBJECTIVE_BRIEFS = {
    # commerce
    "launch_product": "Introduce a product that is new to this audience. Awareness "
                      "and first purchases matter more than margin.",
    "increase_sales": "Lift revenue from an existing catalogue over a short window.",
    "clear_inventory": "Sell through specific stock. Volume matters more than AOV.",
    "acquire_customers": "Reach people who have never bought or signed up.",
    "retarget_customers": "Reach people who already engaged but did not convert.",
    "repeat_purchase": "Bring existing customers back for another order.",
    "promote_collection": "Push a group of products together rather than one hero.",
    # audience and authority
    "grow_audience": "Add followers, subscribers and readers. Judge it on reach and "
                     "new subscribers, never on orders.",
    "launch_content": "Put a significant piece of work into the world and make sure "
                      "it is seen.",
    "repeat_engagement": "Bring an existing audience back to something new.",
    "promote_offer": "Get an existing audience to take up a specific offer.",
    "authority": "Establish credibility on a subject. Measured in published work "
                 "and the audience it reaches, not in immediate response.",
    "generate_leads": "Start qualified conversations. Judge it on enquiries, not "
                      "on revenue in the same window.",
    "acquire_clients": "Reach potential clients who do not know this person yet.",
    # shared
    "seasonal": "A dated moment with a hard start and end. Timing beats everything.",
    "brand_awareness": "Reach and recall, not immediate response. Do not promise a "
                       "revenue return.",
    "custom": "Follow the person's own description of the goal.",
}

# What each outcome can and cannot be measured with. Read by the metrics and
# analyst layers so a persona with no store is never scored on revenue.
OUTCOME_MEASURED_BY = {
    "revenue": "orders whose landing URL carried the campaign tag",
    "content": "published work and the search traffic it earns",
    "pipeline": "published work and the enquiries it starts",
}


def profile(persona: str | None) -> PersonaProfile:
    return PROFILES.get(persona or "", PROFILES[DEFAULT_PERSONA])


def objectives_for(persona: str | None) -> list[dict]:
    p = profile(persona)
    return [{"key": k, "brief": OBJECTIVE_BRIEFS.get(k, "")} for k in p.objectives]


def allows_channel(persona: str | None, channel: str) -> bool:
    return channel in profile(persona).channels


def measures_revenue(persona: str | None) -> bool:
    """Whether attributed revenue is a meaningful headline for this persona.

    False does not mean revenue is hidden -- a freelancer with a connected store
    still sees whatever it earned. It means revenue is not what the campaign is
    JUDGED on, so it does not lead the dashboard and its absence is not failure.
    """
    return profile(persona).outcome == "revenue"


def _validate() -> None:
    """Every channel and template a persona offers must exist.

    Same reason the channel table validates its connectors: a persona offering a
    channel that was renamed becomes an option that silently does nothing.
    """
    from app.services.campaign_channels import CHANNELS
    from app.services.campaign_templates import TEMPLATES

    for p in PROFILES.values():
        unknown = [c for c in p.channels if c not in CHANNELS]
        if unknown:
            raise RuntimeError(f"persona {p.key!r} offers unknown channel(s): {unknown}")
        missing = [t for t in p.templates if t not in TEMPLATES]
        if missing:
            raise RuntimeError(f"persona {p.key!r} offers unknown template(s): {missing}")
        for o in p.objectives:
            if o not in OBJECTIVE_BRIEFS:
                raise RuntimeError(f"persona {p.key!r} offers objective {o!r} with no brief")


_validate()
