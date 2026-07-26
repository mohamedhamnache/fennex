"""Which capability band an org is allowed to reach.

Premium is a paid, opt-in entitlement, never a side effect of the org's
agent_tier preference: it needs a pro-or-above plan AND an explicit flag. Free,
starter and in-trial orgs cap at standard whatever else is set.
"""
from app.services.providers.catalog import BANDS

_RANK = {band: i for i, band in enumerate(BANDS)}

_PREMIUM_PLANS = {"pro", "agency", "enterprise"}


def _plan(org) -> str:
    value = getattr(org, "plan_tier", None)
    return (getattr(value, "value", None) or str(value or "free")).lower()


def max_band(org) -> str:
    if org is None:
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
