import pytest
from app.services.agents.tiers import resolve_model


def test_balanced_light_is_cheap_heavy_is_premium():
    assert resolve_model("balanced", "light", ["anthropic"]) == ("anthropic", "claude-haiku-4-5-20251001")
    assert resolve_model("balanced", "heavy", ["anthropic"]) == ("anthropic", "claude-opus-4-8")


def test_economy_is_cheap_for_both_weights():
    assert resolve_model("economy", "heavy", ["openai"]) == ("openai", "gpt-4o-mini")


def test_max_is_premium_for_both_weights():
    assert resolve_model("max", "light", ["openai"]) == ("openai", "gpt-4o")


def test_prefers_anthropic_when_both_available():
    assert resolve_model("balanced", "heavy", ["openai", "anthropic"])[0] == "anthropic"


def test_falls_back_to_available_provider():
    assert resolve_model("balanced", "heavy", ["openai"]) == ("openai", "gpt-4o")


def test_unknown_tier_defaults_to_balanced():
    assert resolve_model("bogus", "heavy", ["anthropic"]) == ("anthropic", "claude-opus-4-8")


def test_no_providers_raises():
    with pytest.raises(ValueError):
        resolve_model("balanced", "light", [])
