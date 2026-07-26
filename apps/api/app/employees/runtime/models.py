"""Model provider abstraction.

An employee never knows which provider runs it. It declares a weight
("light"/"heavy"); the org's tier decides the grade; this module turns that
into a concrete Strands model. Adding Gemini or Bedrock is a change here and
nowhere else.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# Providers this build can construct, in preference order. Extend by adding a
# builder below -- no employee or router change is needed.
SUPPORTED = ("anthropic", "openai", "bedrock")


@dataclass(frozen=True)
class ModelChoice:
    """What was actually chosen, so telemetry can report it truthfully."""

    provider: str
    model_id: str
    max_tokens: int


class ModelUnavailable(RuntimeError):
    """No configured provider can serve this request."""


def resolve(tier: str, weight: str, available: list[str]) -> ModelChoice:
    """Pick a provider and model from the org's tier and the action's weight.

    Delegates the grading rules to the existing tier resolver so the chat and
    campaign paths cannot drift apart.
    """
    from app.services.agents.tiers import resolve_model

    usable = [p for p in available if p in SUPPORTED]
    if not usable:
        raise ModelUnavailable(
            "No AI key configured. Add an Anthropic or OpenAI key in Settings.")
    provider, model_id = resolve_model(tier, weight, usable)
    max_tokens = 8192 if weight == "heavy" else 2048
    return ModelChoice(provider=provider, model_id=model_id, max_tokens=max_tokens)


def build(choice: ModelChoice, api_key: str):
    """Construct the Strands model for a resolved choice."""
    if choice.provider == "anthropic":
        from strands.models.anthropic import AnthropicModel
        return AnthropicModel(
            client_args={"api_key": api_key},
            model_config={"model_id": choice.model_id, "max_tokens": choice.max_tokens},
        )
    if choice.provider == "openai":
        from strands.models.openai import OpenAIModel
        return OpenAIModel(
            client_args={"api_key": api_key},
            model_id=choice.model_id,
            params={"max_tokens": choice.max_tokens},
        )
    if choice.provider == "bedrock":
        # Bedrock authenticates through the AWS chain rather than a Fennex key.
        from strands.models import BedrockModel
        return BedrockModel(model_id=choice.model_id,
                            max_tokens=choice.max_tokens)
    raise ModelUnavailable(f"Unsupported provider: {choice.provider}")


# Display copy only for the chat picker -- label and hint text a model's id
# alone does not carry. Never consulted for authorization: available() and
# is_allowed() both gate against app.services.providers.catalog, so this
# dict going stale can only show a plain id/generic hint, never open a hole.
_DISPLAY: dict[tuple[str, str], dict] = {
    ("anthropic", "claude-haiku-4-5-20251001"): {
        "label": "Claude Haiku 4.5", "hint": "Quickest and cheapest."},
    ("anthropic", "claude-sonnet-5"): {
        "label": "Claude Sonnet 5", "hint": "Strong reasoning for everyday work."},
    ("anthropic", "claude-opus-5"): {
        "label": "Claude Opus 5", "hint": "Strongest reasoning, costs the most."},
    ("openai", "gpt-4o-mini"): {
        "label": "GPT-4o mini", "hint": "Quickest and cheapest."},
    ("openai", "gpt-4o"): {
        "label": "GPT-4o", "hint": "Strong reasoning for everyday work."},
}

# The chat picker only ever renders two badges (fast/deep); every band above
# cheap reads as "deep" so a new premium catalog row needs no third
# translation key on the frontend.
_GRADE_FOR_BAND = {"cheap": "fast", "standard": "deep", "premium": "deep"}


def _catalog_rows(provider: str) -> list[tuple[str, str]]:
    """(band, model) pairs for one provider, cheapest band first, de-duplicated
    so a model listed in more than one band is only offered once."""
    from app.services.providers import catalog

    rows = [(band, model) for band, p, model in catalog.rows() if p == provider]
    rows.sort(key=lambda r: catalog.BANDS.index(r[0]) if r[0] in catalog.BANDS else 0)
    seen: set[str] = set()
    ordered = []
    for band, model in rows:
        if model in seen:
            continue
        seen.add(model)
        ordered.append((band, model))
    return ordered


def _highest_band(provider: str, model_id: str) -> Optional[str]:
    """The most expensive band this (provider, model) is catalogued under, or
    None if the pair is not catalogued at all. A model can be listed under
    more than one band; entitlement is checked against the priciest one so a
    premium row cannot be laundered through a cheaper listing."""
    from app.services.providers import catalog

    bands = {band for band, p, model in catalog.rows()
             if p == provider and model == model_id}
    if not bands:
        return None
    return max(bands, key=catalog.BANDS.index)


def available(keys: dict) -> list[dict]:
    """Models this organisation can actually run, given its keys.

    Reads app.services.providers.catalog -- the same source is_allowed()
    checks -- so the picker's list and the gate it is checked against cannot
    desynchronise again.
    """
    out = []
    for provider in SUPPORTED:
        if provider not in keys:
            continue
        for band, model in _catalog_rows(provider):
            meta = _DISPLAY.get((provider, model), {})
            out.append({
                "id": model,
                "provider": provider,
                "grade": _GRADE_FOR_BAND.get(band, "deep"),
                "label": meta.get("label", model),
                "hint": meta.get("hint", ""),
            })
    return out


def is_allowed(provider: str, model_id: str, keys: dict) -> bool:
    """Only a catalogued model on a configured provider may be chosen."""
    if provider not in keys:
        return False
    from app.services.providers import catalog
    return (provider, model_id) in catalog.known_models()


def for_action(tier: str, weight: str, keys: dict, *,
               provider_override: Optional[str] = None,
               model_override: Optional[str] = None,
               org=None):
    """Resolve and construct in one step. Returns (model, ModelChoice).

    An override is only honoured up to what the org may reach: picking a
    catalogued model whose highest band exceeds the org's entitlement (see
    app.core.entitlements) is rejected exactly like an uncatalogued model
    would be, and falls back to normal tier resolution rather than raising.
    `org` defaults to None, which caps at "standard" -- the safe default when
    a caller has no org in scope.
    """
    override_ok = bool(provider_override) and is_allowed(
        provider_override, model_override or "", keys)
    if override_ok:
        from app.core.entitlements import cap_band

        band = _highest_band(provider_override, model_override or "")
        if band is not None and cap_band(band, org) != band:
            override_ok = False

    if override_ok:
        choice = ModelChoice(
            provider=provider_override,
            model_id=model_override or resolve(tier, weight, [provider_override]).model_id,
            max_tokens=8192 if weight == "heavy" else 2048)
    else:
        choice = resolve(tier, weight, list(keys.keys()))
    return build(choice, keys.get(choice.provider, "")), choice
