from app.services.agents import policy
from app.services.providers import catalog


def test_unknown_feature_defaults_to_cheap():
    """New features start cheap and are promoted only on evidence (spec 3.4.2)."""
    p = policy.policy_for("a-feature-nobody-registered")
    assert p.band == "cheap"
    assert p.needs_premium is False
    assert p.max_output_tokens <= 1024


def test_none_feature_returns_the_default():
    assert policy.policy_for(None) is policy.DEFAULT_POLICY


def test_short_form_features_are_cheap():
    for feature in ("meta_description", "alt_text", "title", "tags", "keyword_clustering"):
        assert policy.policy_for(feature).band == "cheap", feature


def test_long_form_features_are_standard():
    for feature in ("article_draft", "brand_voice", "discovery", "competitor_gap"):
        assert policy.policy_for(feature).band == "standard", feature


def test_no_feature_is_premium_by_default_band():
    """Premium is reached through needs_premium plus entitlement, never by a
    policy band alone -- this is what keeps Opus off by default."""
    assert all(p.band != "premium" for p in policy.FEATURE_POLICY.values())


def test_editorial_polish_is_the_only_premium_candidate():
    premium = [k for k, p in policy.FEATURE_POLICY.items() if p.needs_premium]
    assert premium == ["editorial_polish"]


def test_every_policy_band_is_a_real_band():
    for name, p in policy.FEATURE_POLICY.items():
        assert p.band in catalog.BANDS, name


def test_output_caps_are_sane():
    """Output costs ~5x input, so every feature carries an explicit ceiling."""
    for name, p in policy.FEATURE_POLICY.items():
        assert 0 < p.max_output_tokens <= 8192, name
    assert policy.policy_for("meta_description").max_output_tokens <= 256


def test_cascade_only_on_structured_or_bounded_features():
    for name, p in policy.FEATURE_POLICY.items():
        if p.cascade:
            assert p.band in ("cheap", "standard"), name
