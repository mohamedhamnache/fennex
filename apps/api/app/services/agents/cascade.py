"""Cheap-first generation with a programmatic validator.

Run the policy band, check the output with code, and escalate exactly one band
with one retry when it fails. No LLM judge: cheap models fail on format, not on
taste, and a judge would cost a call on every generation to catch what parsing
already catches for free (spec 3.4.3 technique #2).
"""
import json
import logging
import re
from typing import Callable

from app.core.entitlements import cap_band
from app.services.agents.policy import policy_for
from app.services.agents.tiers import resolve_model
from app.services.llm_service import call_llm
from app.services.providers.catalog import BANDS, resolve_band

logger = logging.getLogger(__name__)

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


class validators:
    """Objective checks only -- the failure mode of a cheap model is broken
    format, not weak prose."""

    @staticmethod
    def non_empty(text: str) -> bool:
        return bool(text and text.strip())

    @staticmethod
    def json_object(required: tuple[str, ...] = ()) -> Callable[[str], bool]:
        def check(text: str) -> bool:
            try:
                data = json.loads(_FENCE.sub("", text or ""))
            except (ValueError, TypeError):
                return False
            if not isinstance(data, dict):
                return False
            return all(key in data for key in required)
        return check

    @staticmethod
    def max_chars(limit: int) -> Callable[[str], bool]:
        def check(text: str) -> bool:
            return len(text or "") <= limit
        return check


def _next_band(band: str) -> str | None:
    i = BANDS.index(band) if band in BANDS else 0
    return BANDS[i + 1] if i + 1 < len(BANDS) else None


async def call_with_cascade(*, keys: dict[str, str], feature: str, system_prompt: str,
                            user_prompt: str, tier: str = "balanced", weight: str = "light",
                            locale: str | None = "en", org=None,
                            validate: Callable[[str], bool] | None = None,
                            meter: dict | None = None) -> str:
    """Generate at the policy band, escalate one band on a validation failure.

    Returns the last response either way -- the caller's own parsing decides
    what a still-bad response means. Both attempts are metered separately, so
    the ledger shows the true cost of a cascade.
    """
    available = list(keys)
    if not available:
        raise ValueError("No LLM provider keys available.")
    check = validate or validators.non_empty
    policy = policy_for(feature)

    provider, model = resolve_model(tier, weight, available, feature=feature, org=org)
    text = await call_llm(provider, model, keys[provider], system_prompt, user_prompt,
                          locale=locale, meter=meter, feature=feature)
    if check(text):
        return text

    higher = _next_band(policy.band)
    if higher is None:
        return text
    up_provider, up_model = resolve_band(cap_band(higher, org), available)
    if (up_provider, up_model) == (provider, model):
        # The escalation landed on the same model (entitlement cap, or the band
        # has no distinct row). Re-running it would burn a call for nothing.
        return text
    logger.info("cascade escalating feature=%s from %s:%s to %s:%s",
                feature, provider, model, up_provider, up_model)
    return await call_llm(up_provider, up_model, keys[up_provider], system_prompt,
                          user_prompt, locale=locale, meter=meter, feature=feature)
