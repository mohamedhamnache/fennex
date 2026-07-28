from app.services.prompting import modules, vocab


def test_each_module_returns_none_when_it_has_nothing_to_say():
    """A module that contributes nothing must omit itself, not emit an empty
    fragment that leaves double separators in the final prompt."""
    assert modules.user_intent("") is None
    assert modules.user_intent("   ") is None
    assert modules.brand_style(None) is None


def test_lighting_module_uses_the_vocabulary_fragment():
    frag = modules.lighting("golden_hour")
    assert frag is not None
    assert vocab.LIGHTING["golden_hour"] in frag


def test_unknown_vocabulary_token_is_rejected_not_silently_dropped():
    import pytest
    with pytest.raises(KeyError):
        modules.lighting("disco_ball")


def test_preservation_strength_scales_the_fragment():
    weak = modules.product_preservation(20)
    strong = modules.product_preservation(100)
    assert weak != strong
    # the non-negotiable identity clause is present at every strength
    for frag in (weak, strong):
        for term in ("geometry", "proportions", "label", "logo", "colours"):
            assert term in frag.lower()
