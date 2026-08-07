"""Resolve (provider, model) from the org's agent tier, a skill's weight, and
the feature's policy.

Bands, not model ids: the concrete model comes from model_catalog, so swapping a
supplier is a data change. Premium is never reachable from agent_tier alone --
it needs a needs_premium feature AND an entitled org (see core.entitlements).
That is what keeps expensive models off by default.
"""
import logging

from app.core.entitlements import cap_band
from app.services.agents.policy import policy_for
from app.services.providers.catalog import resolve_band

logger = logging.getLogger(__name__)

# tier -> weight -> band
_TIERS: dict[str, dict[str, str]] = {
    "economy": {"light": "cheap", "medium": "cheap", "heavy": "cheap"},
    # "medium" is analysis, not authorship: reasoning over data the tools
    # already fetched, which the cheap model does well. Only genuinely heavy
    # work -- writing a full article, art direction -- earns the standard band.
    "balanced": {"light": "cheap", "medium": "cheap", "heavy": "standard"},
    "max": {"light": "standard", "medium": "standard", "heavy": "standard"},
}

# Weights an action may declare. Anything outside this set is a typo, and a
# typo used to be invisible: the lookup below fell through to "standard", so a
# misspelled weight silently bought the expensive model.
KNOWN_WEIGHTS = frozenset({"light", "medium", "heavy"})


def band_for(tier: str, weight: str) -> str:
    """Cost band for a weight.

    "medium" was missing from every tier row, so `.get(weight, "standard")`
    quietly billed it at the heavy rate -- Souk's growth audit and conversion
    review both answered on gpt-4o rather than gpt-4o-mini, roughly twenty
    times the price, with nothing in the code or logs saying so. Found by
    displaying the model in the chat, which is the argument for displaying it.

    An unknown weight still resolves to "standard": it is safer to overpay than
    to silently downgrade work someone asked for. But it now warns, so the next
    one is noticed rather than absorbed.
    """
    if weight not in KNOWN_WEIGHTS:
        logger.warning("unknown action weight %r -- billing at the standard band; "
                       "expected one of %s", weight, sorted(KNOWN_WEIGHTS))
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
