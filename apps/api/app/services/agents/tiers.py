"""Resolve (provider, model) from the org's agent tier, a skill's weight, and
the feature's policy.

Bands, not model ids: the concrete model comes from model_catalog, so swapping a
supplier is a data change. Premium is never reachable from agent_tier alone --
it needs a needs_premium feature AND an entitled org (see core.entitlements).
That is what keeps expensive models off by default.
"""
from app.core.entitlements import cap_band
from app.services.agents.policy import policy_for
from app.services.providers.catalog import resolve_band

# tier -> weight -> band
_TIERS: dict[str, dict[str, str]] = {
    "economy": {"light": "cheap", "heavy": "cheap"},
    "balanced": {"light": "cheap", "heavy": "standard"},
    "max": {"light": "standard", "heavy": "standard"},
}


def band_for(tier: str, weight: str) -> str:
    return _TIERS.get(tier, _TIERS["balanced"]).get(weight, "standard")


def resolve_model(tier: str, weight: str, available: list[str], *,
                  feature: str | None = None, org=None,
                  needs: dict | None = None) -> tuple[str, str]:
    """Return (provider, model). `feature` applies the policy band; `org` allows
    a needs_premium feature to reach premium when the org is entitled."""
    if not available:
        raise ValueError("No LLM provider keys available.")
    policy = policy_for(feature)
    band = policy.band if feature is not None else band_for(tier, weight)
    if policy.needs_premium:
        band = "premium"
    band = cap_band(band, org)
    return resolve_band(band, available, needs)
