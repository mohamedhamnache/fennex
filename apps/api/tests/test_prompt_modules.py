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


def test_brand_style_reads_tone_directly_off_the_brand_kit():
    """Task 3, Part A: brand-kit tone used to have no home in modules.brand_style
    (callers had to smuggle it through user_prompt instead). It's now part of
    the brand fragment itself."""

    class _Kit:
        colors = ["#111111"]
        style_rules = None
        tone = "Playful"

    frag = modules.brand_style(_Kit())
    assert frag is not None
    assert "Tone: Playful" in frag


def test_environment_module_prefers_curated_description_over_the_stub():
    """Task 3, Part A: when a caller resolves a scene id to its curated text
    and passes it as `description`, that text is used verbatim instead of
    the generic 'Scene: <id>' stub."""
    assert modules.environment("cafe_table") == "Scene: cafe table"
    frag = modules.environment("cafe_table", "on a rustic wooden café table")
    assert frag == "on a rustic wooden café table"


def test_preservation_strength_scales_the_fragment():
    weak = modules.product_preservation(20)
    strong = modules.product_preservation(100)
    assert weak != strong
    # the non-negotiable identity clause is present at every strength
    for frag in (weak, strong):
        for term in ("geometry", "proportions", "label", "logo", "colours"):
            assert term in frag.lower()
