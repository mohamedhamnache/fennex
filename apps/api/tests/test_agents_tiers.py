from types import SimpleNamespace

import pytest

from app.models.organization import PlanTier
from app.services.agents.tiers import band_for, resolve_model
from app.services.providers import catalog


@pytest.fixture(autouse=True)
def clean_snapshot():
    catalog.invalidate_snapshot()
    yield
    catalog.invalidate_snapshot()


def _org(plan=PlanTier.PRO, flag=True):
    return SimpleNamespace(plan_tier=plan, premium_models_enabled=flag)


def test_heavy_work_on_balanced_is_standard_not_opus():
    """The Phase 1b headline: balanced/heavy stops routing to an Opus model."""
    assert band_for("balanced", "heavy") == "standard"
    assert resolve_model("balanced", "heavy", ["openai", "anthropic"]) == ("openai", "gpt-4o")


def test_economy_is_cheap_for_both_weights():
    assert resolve_model("economy", "heavy", ["openai"]) == ("openai", "gpt-4o-mini")
    assert resolve_model("economy", "light", ["openai"]) == ("openai", "gpt-4o-mini")


def test_max_tier_tops_out_at_standard_without_a_premium_feature():
    assert band_for("max", "heavy") == "standard"
    assert resolve_model("max", "heavy", ["openai", "anthropic"]) == ("openai", "gpt-4o")


def test_openai_is_preferred_when_both_providers_available():
    assert resolve_model("balanced", "heavy", ["openai", "anthropic"])[0] == "openai"


def test_falls_back_to_anthropic_when_openai_key_is_missing():
    assert resolve_model("balanced", "heavy", ["anthropic"]) == ("anthropic", "claude-sonnet-5")


def test_unknown_tier_defaults_to_balanced():
    assert band_for("bogus", "heavy") == "standard"


def test_no_providers_raises():
    with pytest.raises(ValueError):
        resolve_model("balanced", "light", [])


def test_premium_feature_reaches_premium_only_for_an_entitled_org():
    entitled = resolve_model("balanced", "heavy", ["openai", "anthropic"],
                             feature="editorial_polish", org=_org())
    assert entitled == ("anthropic", "claude-opus-5")


def test_premium_feature_is_capped_for_an_unentitled_org():
    for org in (_org(PlanTier.STARTER, True), _org(PlanTier.PRO, False), None):
        assert resolve_model("balanced", "heavy", ["openai", "anthropic"],
                             feature="editorial_polish", org=org) == ("openai", "gpt-4o")


def test_feature_policy_overrides_the_tier_band():
    """A cheap feature stays cheap even on the max tier."""
    assert resolve_model("max", "heavy", ["openai"], feature="alt_text") == ("openai", "gpt-4o-mini")


def test_unregistered_feature_routes_cheap():
    assert resolve_model("max", "heavy", ["openai"], feature="brand-new-thing") == ("openai", "gpt-4o-mini")
