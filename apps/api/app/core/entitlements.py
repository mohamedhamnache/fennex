"""Which capability band an org is allowed to reach.

Premium is a paid, opt-in entitlement, never a side effect of the org's
agent_tier preference: it needs a pro-or-above plan AND an explicit flag. Free,
starter and in-trial orgs cap at standard whatever else is set.
"""
from datetime import datetime, timezone

from app.services.providers.catalog import BANDS

_RANK = {band: i for i, band in enumerate(BANDS)}

_PREMIUM_PLANS = {"pro", "agency", "enterprise"}


def _plan(org) -> str:
    value = getattr(org, "plan_tier", None)
    return (getattr(value, "value", None) or str(value or "free")).lower()


def _in_trial(org) -> bool:
    """True while trial_ends_at is set and in the future. Stripe flips
    plan_tier to pro at subscription-create time, before the trial ends, so
    plan_tier alone is not enough to tell a paying org from a trialing one.
    Never raises: a naive (tzinfo-less) trial_ends_at is compared against a
    naive "now" instead of blowing up on the aware/naive mismatch."""
    trial_ends_at = getattr(org, "trial_ends_at", None)
    if trial_ends_at is None:
        return False
    try:
        now_aware = datetime.now(timezone.utc)
        now = now_aware.replace(tzinfo=None) if trial_ends_at.tzinfo is None else now_aware
        return trial_ends_at > now
    except TypeError:
        return False


def max_band(org) -> str:
    if org is None:
        return "standard"
    if _in_trial(org):
        return "standard"
    if _plan(org) in _PREMIUM_PLANS and bool(getattr(org, "premium_models_enabled", False)):
        return "premium"
    return "standard"


def cap_band(band: str, org) -> str:
    """Clamp a requested band down to what the org may reach. Never raises: a
    policy asking for premium on a starter org silently gets standard."""
    ceiling = max_band(org)
    if _RANK.get(band, 0) <= _RANK[ceiling]:
        return band
    return ceiling
