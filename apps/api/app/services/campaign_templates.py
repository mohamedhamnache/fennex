"""Campaign templates: a starting shape, not a finished campaign.

A template carries the parts that are true of the OCCASION regardless of the
store -- what a Black Friday campaign is trying to do, which channels it usually
runs on, how many days before launch the creative has to exist. It never carries
copy, products, prices or a budget, because those are properties of the merchant
and a template that guesses them produces a campaign that is subtly about
someone else's shop.

Timeline offsets are relative to launch day, which is what makes a template
portable: "creative production at D-5" survives being applied to any start date.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Template:
    key: str
    label: str
    objective: str
    description: str
    channels: list[str] = field(default_factory=list)
    audience_key: str = ""
    primary_kpi: str = "revenue"
    offer_type: str = "none"
    # (day_offset, title, owner)
    timeline: list[tuple] = field(default_factory=list)
    duration_days: int = 7


# The standard pre-launch sequence, shared by templates that launch something.
_LAUNCH_TIMELINE = [
    (-7, "Set the strategy and the offer", "sirocco"),
    (-5, "Produce the creative", "mirage"),
    (-3, "Write the email and social copy", "dune"),
    (-2, "Build the audience", "souk"),
    (0, "Launch", ""),
    (2, "First performance review", "souk"),
    (5, "Optimise what is working", "souk"),
    (7, "Close the campaign and record what it taught", "souk"),
]

_SALE_TIMELINE = [
    (-5, "Choose the products and the discount", "souk"),
    (-3, "Produce the creative", "mirage"),
    (-2, "Write the announcement and the reminder", "dune"),
    (0, "Sale opens", ""),
    (1, "Reminder to non-openers", ""),
    (3, "Last-chance message", ""),
    (4, "Close and report", "souk"),
]

TEMPLATES: dict[str, Template] = {t.key: t for t in [
    Template("product_launch", "Product launch", "launch_product",
             "Introduce a new product across owned and social channels.",
             ["email", "instagram", "meta_ads", "blog"], "returning_customers",
             "revenue", "none", _LAUNCH_TIMELINE, 14),
    Template("black_friday", "Black Friday", "increase_sales",
             "The year's heaviest discount window, with a warm-up and a last call.",
             ["email", "sms", "meta_ads", "instagram", "shopify"], "",
             "revenue", "discount", [
                 (-14, "Decide the offer and the margin floor", "souk"),
                 (-10, "Produce the creative", "mirage"),
                 (-7, "Warm-up email to the list", "dune"),
                 (-1, "Early access for VIPs", ""),
                 (0, "Black Friday opens", ""),
                 (1, "Reminder to non-openers", ""),
                 (3, "Cyber Monday push", ""),
                 (5, "Close and report", "souk"),
             ], 6),
    Template("summer_sale", "Summer sale", "increase_sales",
             "A seasonal discount window on in-season stock.",
             ["email", "instagram", "shopify"], "", "revenue", "discount",
             _SALE_TIMELINE, 10),
    Template("christmas", "Christmas", "seasonal",
             "Gifting-led campaign with a hard shipping deadline.",
             ["email", "instagram", "meta_ads", "shopify"], "", "revenue", "none", [
                 (-21, "Choose the gifting selection", "souk"),
                 (-14, "Produce the creative", "mirage"),
                 (-10, "Gift guide published", "dune"),
                 (0, "Campaign opens", ""),
                 (7, "Shipping deadline reminder", ""),
                 (12, "Close and report", "souk"),
             ], 21),
    Template("valentines", "Valentine's Day", "seasonal",
             "A short gifting window with a single clear deadline.",
             ["email", "instagram", "meta_ads"], "", "revenue", "none",
             _LAUNCH_TIMELINE, 10),
    Template("flash_sale", "Flash sale", "increase_sales",
             "48 hours, one offer, maximum urgency.",
             ["email", "sms", "instagram"], "recent_purchasers", "orders", "discount", [
                 (-3, "Pick the products and the discount", "souk"),
                 (-2, "Produce the creative and copy", "mirage"),
                 (0, "Sale opens", ""),
                 (1, "Final hours reminder", ""),
                 (2, "Close and report", "souk"),
             ], 2),
    Template("new_collection", "New collection", "promote_collection",
             "Launch a group of products together rather than one hero.",
             ["email", "instagram", "blog", "landing_page"], "returning_customers",
             "revenue", "none", _LAUNCH_TIMELINE, 14),
    Template("back_in_stock", "Back in stock", "increase_sales",
             "Tell the people who wanted it that it has returned.",
             ["email", "sms"], "product_viewers", "orders", "none", [
                 (-1, "Write the notification", "dune"),
                 (0, "Send", ""),
                 (3, "Close and report", "souk"),
             ], 5),
    Template("clearance", "Clearance", "clear_inventory",
             "Sell through specific stock. Volume over margin.",
             ["email", "shopify", "instagram"], "", "orders", "discount",
             _SALE_TIMELINE, 14),
    Template("winback", "Customer winback", "repeat_purchase",
             "Reach customers who have gone quiet.",
             ["email", "sms", "meta_ads"], "inactive", "orders", "discount", [
                 (-3, "Define the quiet window and the incentive", "souk"),
                 (-2, "Write the message", "dune"),
                 (0, "Send", ""),
                 (4, "Second attempt to non-openers", ""),
                 (7, "Close and report", "souk"),
             ], 10),
    Template("abandoned_cart", "Abandoned cart", "retarget_customers",
             "Recover checkouts that were started and not finished.",
             ["email", "sms", "meta_ads"], "cart_abandoners", "orders", "none", [
                 (-2, "Write the recovery sequence", "dune"),
                 (0, "First message", ""),
                 (1, "Second message", ""),
                 (3, "Final message with incentive", ""),
             ], 7),
    Template("vip", "VIP campaign", "repeat_purchase",
             "Early access or a private offer for the best customers.",
             ["email", "sms"], "vip", "revenue", "none", _LAUNCH_TIMELINE, 7),
    Template("retargeting", "Retargeting", "retarget_customers",
             "Reach people who engaged but did not buy.",
             ["meta_ads", "google_ads"], "product_viewers", "orders", "none", [
                 (-3, "Define the audience window", "souk"),
                 (-2, "Produce the creative", "mirage"),
                 (0, "Launch", ""),
                 (4, "Review and reallocate", "souk"),
             ], 14),
    Template("product_education", "Product education", "brand_awareness",
             "Teach what the product does before asking for the sale.",
             ["blog", "email", "instagram"], "", "reach", "none", [
                 (-7, "Choose the question the content answers", "zerda"),
                 (-4, "Write the article", "dune"),
                 (-2, "Produce the visuals", "mirage"),
                 (0, "Publish and distribute", ""),
                 (7, "Review what it earned", "souk"),
             ], 21),
    Template("brand_awareness", "Brand awareness", "brand_awareness",
             "Reach and recall. Judged on reach, not on immediate orders.",
             ["instagram", "tiktok", "meta_ads"], "", "reach", "none",
             _LAUNCH_TIMELINE, 21),
]}


def _validate() -> None:
    """Every channel and audience a template names must exist.

    Same reason the channel table validates its connectors: a template naming a
    channel that was later renamed becomes a campaign with a missing piece, and
    nobody finds out until launch.
    """
    from app.services.campaign_audience import PRESETS
    from app.services.campaign_channels import CHANNELS

    for t in TEMPLATES.values():
        unknown = [c for c in t.channels if c not in CHANNELS]
        if unknown:
            raise RuntimeError(f"template {t.key!r} names unknown channel(s): {unknown}")
        if t.audience_key and t.audience_key not in PRESETS:
            raise RuntimeError(f"template {t.key!r} names unknown audience {t.audience_key!r}")


_validate()


def to_dict(t: Template) -> dict:
    return {"key": t.key, "label": t.label, "objective": t.objective,
            "description": t.description, "channels": t.channels,
            "audienceKey": t.audience_key, "primaryKpi": t.primary_kpi,
            "offerType": t.offer_type, "durationDays": t.duration_days,
            "timeline": [{"day_offset": d, "title": title, "owner": owner}
                         for d, title, owner in t.timeline]}


def catalogue() -> list[dict]:
    return [to_dict(t) for t in TEMPLATES.values()]
