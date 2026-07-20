"""Resolve (provider, model) from the org's agent tier and a skill's weight."""

# provider preference order when an org has multiple keys
_ORDER = ["anthropic", "openai"]

# grade -> provider -> model id
_MODELS = {
    "cheap":   {"anthropic": "claude-haiku-4-5-20251001", "openai": "gpt-4o-mini"},
    "premium": {"anthropic": "claude-opus-4-8",           "openai": "gpt-4o"},
}
# tier -> {weight -> "cheap"|"premium"}
_TIERS = {
    "economy":  {"light": "cheap",   "heavy": "cheap"},
    "balanced": {"light": "cheap",   "heavy": "premium"},
    "max":      {"light": "premium", "heavy": "premium"},
}


def resolve_model(tier: str, weight: str, available: list[str]) -> tuple[str, str]:
    if not available:
        raise ValueError("No LLM provider keys available.")
    grade = _TIERS.get(tier, _TIERS["balanced"]).get(weight, "premium")
    provider = next((p for p in _ORDER if p in available), available[0])
    return provider, _MODELS[grade][provider]
