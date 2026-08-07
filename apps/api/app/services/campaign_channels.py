"""Channels a campaign can run on, and whether this org can actually run them.

DISCOVERY, NOT HARDCODING. A channel never names a vendor it must have. It
declares the *kind* of connector that could execute it, and executability is
resolved at request time against what the org has connected -- native tools and
MCP connectors alike, through one lookup. Connect Klaviyo and the email channel
becomes executable; connect Mailchimp instead and it becomes executable the same
way. Nothing here changes.

Every `connector_apps` entry is checked against the live MCP catalogue at import
time. A typo in this table would otherwise become a channel that can never be
satisfied, and the merchant would read "connect meta_ads" forever while the
catalogue calls it "meta-ads".

WHAT PLANNING DOES NOT REQUIRE. A channel with no connector is still worth
planning -- writing the launch email before choosing an ESP is normal, and the
content is portable. So a missing connector blocks EXECUTION, never drafting,
and the readiness check reports it as a blocker on launch rather than an error
on save.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.employees.runtime import mcp
from app.models.connector import Connector

# Approval gates. These name consequences, not features: each one is money
# leaving the account, a message reaching a customer, or a price changing.
ACT_SPEND = "spend"
ACT_LAUNCH_ADS = "launch_ads"
ACT_SEND_EMAIL = "send_email"
ACT_SEND_SMS = "send_sms"
ACT_CHANGE_PRICE = "change_price"
ACT_CREATE_DISCOUNT = "create_discount"

APPROVAL_LABELS = {
    ACT_SPEND: "Spend budget",
    ACT_LAUNCH_ADS: "Launch paid ads",
    ACT_SEND_EMAIL: "Send email to customers",
    ACT_SEND_SMS: "Send SMS to customers",
    ACT_CHANGE_PRICE: "Change product prices",
    ACT_CREATE_DISCOUNT: "Create a discount code",
}


@dataclass(frozen=True)
class ChannelDef:
    key: str
    label: str
    group: str                       # paid | owned | social | onsite
    # Any ONE of these being connected makes the channel executable. Order is
    # preference, not requirement.
    connector_apps: list[str] = field(default_factory=list)
    utm_source: str = ""
    utm_medium: str = ""
    # What the content studio produces for this channel.
    content_kinds: list[str] = field(default_factory=list)
    approvals: list[str] = field(default_factory=list)
    spends_money: bool = False
    # A channel Fennex can produce content for but cannot publish to, ever,
    # because no connector exists in the catalogue. Named so the UI can offer
    # "copy to clipboard" rather than a dead Publish button.
    manual_only: bool = False


CHANNELS: dict[str, ChannelDef] = {c.key: c for c in [
    # ── paid ─────────────────────────────────────────────────────────────────
    ChannelDef("meta_ads", "Meta Ads", "paid", ["meta-ads"], "facebook", "cpc",
               ["ad_concept", "headline", "primary_text", "cta", "image"],
               [ACT_SPEND, ACT_LAUNCH_ADS], spends_money=True),
    ChannelDef("google_ads", "Google Ads", "paid", ["google-ads"], "google", "cpc",
               ["headline", "primary_text", "cta"],
               [ACT_SPEND, ACT_LAUNCH_ADS], spends_money=True),
    ChannelDef("tiktok_ads", "TikTok Ads", "paid", ["tiktok-ads"], "tiktok", "cpc",
               ["hook", "ad_concept", "cta", "image"],
               [ACT_SPEND, ACT_LAUNCH_ADS], spends_money=True),
    ChannelDef("pinterest", "Pinterest", "paid", ["pinterest"], "pinterest", "social",
               ["headline", "post", "image"], []),

    # ── owned ────────────────────────────────────────────────────────────────
    # Email lists two ESPs and a direct sender. Whichever is connected wins.
    ChannelDef("email", "Email", "owned", ["klaviyo", "mailchimp", "gmail", "email"],
               "newsletter", "email",
               ["subject", "primary_text", "cta", "image"], [ACT_SEND_EMAIL]),
    # No SMS connector exists in the catalogue yet. Declared anyway, because the
    # copy is still worth writing -- and marked so the UI never offers to send.
    ChannelDef("sms", "SMS", "owned", [], "sms", "sms",
               ["primary_text", "cta"], [ACT_SEND_SMS], manual_only=True),
    ChannelDef("push", "Push notification", "owned", [], "push", "push",
               ["headline", "primary_text"], [], manual_only=True),

    # ── social ───────────────────────────────────────────────────────────────
    ChannelDef("instagram", "Instagram", "social", ["instagram"], "instagram", "social",
               ["hook", "post", "image", "cta"], []),
    ChannelDef("facebook", "Facebook", "social", ["facebook"], "facebook", "social",
               ["post", "image", "cta"], []),
    ChannelDef("tiktok", "TikTok", "social", ["tiktok-ads"], "tiktok", "social",
               ["hook", "post"], []),

    # ── onsite ───────────────────────────────────────────────────────────────
    ChannelDef("blog", "Blog article", "onsite", ["wordpress", "webflow", "ghost"],
               "blog", "organic", ["headline", "primary_text"], []),
    ChannelDef("landing_page", "Landing page", "onsite", ["wordpress", "webflow", "ghost", "framer"],
               "site", "referral", ["headline", "primary_text", "cta", "image"], []),
    # The store itself: publishing the product, and the discount behind the offer.
    ChannelDef("shopify", "Store", "onsite", ["shopify", "woocommerce"], "store", "owned",
               ["primary_text"], [ACT_CREATE_DISCOUNT, ACT_CHANGE_PRICE]),
]}


def _validate() -> None:
    """Every declared connector must exist in the MCP catalogue.

    Runs at import so a typo fails on startup, next to the coherence and
    metering audits, rather than becoming a channel nobody can ever satisfy.
    """
    known = set(mcp.CATALOGUE)
    for c in CHANNELS.values():
        unknown = [a for a in c.connector_apps if a not in known]
        if unknown:
            raise RuntimeError(
                f"channel {c.key!r} declares connector(s) not in the MCP catalogue: {unknown}")
        if not c.connector_apps and not c.manual_only:
            raise RuntimeError(
                f"channel {c.key!r} has no connector and is not marked manual_only")


_validate()


async def connected_apps(project_id: uuid.UUID, org_id: uuid.UUID,
                         db: AsyncSession) -> dict[str, bool]:
    """Everything this org can reach, by app key.

    Two sources, merged: native tools (Shopify, Search Console, WordPress --
    reachable because a project connected them) and MCP connectors (rows in the
    connectors table). An app is available if EITHER path works, which is what
    makes a channel's `connector_apps` list a genuine either/or.
    """
    from app.employees import toolbelt

    out: dict[str, bool] = {}
    try:
        out.update(await toolbelt.available_apps(project_id, org_id, db))
    except Exception:  # noqa: BLE001 - a toolbelt failure must not hide connectors
        pass

    rows = (await db.execute(select(Connector).where(
        Connector.org_id == org_id, Connector.enabled.is_(True)
    ))).scalars().all()
    for row in rows:
        # An MCP connector counts as available unless its last check failed.
        # `None` means never checked, which is not the same as broken.
        out[row.app] = out.get(row.app, False) or row.last_status != "error"
    return out


def executor_for(channel: str, available: dict[str, bool]) -> str | None:
    """The app that would execute this channel, or None if nothing is connected."""
    c = CHANNELS.get(channel)
    if c is None:
        return None
    return next((a for a in c.connector_apps if available.get(a)), None)


def describe(channel: str, available: dict[str, bool]) -> dict:
    """One channel, with its live executability. Shape the UI renders directly."""
    c = CHANNELS.get(channel)
    if c is None:
        return {"key": channel, "label": channel, "known": False}
    app = executor_for(channel, available)
    return {
        "key": c.key, "label": c.label, "group": c.group,
        "utm": {"source": c.utm_source, "medium": c.utm_medium},
        "contentKinds": c.content_kinds,
        "approvals": [{"action": a, "label": APPROVAL_LABELS[a]} for a in c.approvals],
        "spendsMoney": c.spends_money,
        "manualOnly": c.manual_only,
        "executor": app,
        "executable": bool(app),
        # What to connect, when nothing is. Empty for a manual-only channel:
        # telling someone to connect an SMS provider that Fennex cannot talk to
        # would be an instruction that cannot be followed.
        "connectOneOf": [] if c.manual_only else [
            {"app": a, "label": mcp.CATALOGUE[a].label} for a in c.connector_apps
        ],
    }


def catalogue(available: dict[str, bool]) -> list[dict]:
    return [describe(k, available) for k in CHANNELS]
