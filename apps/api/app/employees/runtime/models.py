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


def for_action(tier: str, weight: str, keys: dict, *,
               provider_override: Optional[str] = None,
               model_override: Optional[str] = None):
    """Resolve and construct in one step. Returns (model, ModelChoice)."""
    if provider_override and provider_override in keys:
        choice = ModelChoice(
            provider=provider_override,
            model_id=model_override or resolve(tier, weight, [provider_override]).model_id,
            max_tokens=8192 if weight == "heavy" else 2048)
    else:
        choice = resolve(tier, weight, list(keys.keys()))
    return build(choice, keys.get(choice.provider, "")), choice
