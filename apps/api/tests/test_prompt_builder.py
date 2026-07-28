from app.services.prompting import PromptBuilder, ShowcaseSpec, Product3DSpec, vocab


def _spec(**kw):
    base = dict(scene_id="luxury_studio", lighting="softbox", camera="85mm",
                aspect_ratio="1:1", creativity=40, product_preservation=90,
                user_prompt="", negative_prompt="", seed=None, quality="high",
                product_description="")
    base.update(kw)
    return ShowcaseSpec(**base)


def test_showcase_carries_the_verbatim_system_prompt():
    r = PromptBuilder.build_product_showcase(_spec(), None)
    assert r.system_prompt == vocab.SHOWCASE_SYSTEM_PROMPT
    assert "award-winning luxury commercial product photographer" in r.system_prompt


def test_user_intent_is_appended_last_and_never_replaces_direction():
    r = PromptBuilder.build_product_showcase(
        _spec(user_prompt="Luxury bathroom with warm sunlight."), None)
    assert "Luxury bathroom with warm sunlight." in r.prompt
    # it lands after the preservation direction, so it refines rather than overrides
    assert r.prompt.index("Luxury bathroom") > r.prompt.lower().index("geometry")


def test_negative_prompt_covers_every_required_exclusion():
    neg = PromptBuilder.build_negative_prompt()
    for term in vocab.NEGATIVE_TERMS:
        assert term.lower() in neg.lower()
    assert len(vocab.NEGATIVE_TERMS) >= 11


def test_user_negative_is_appended_not_substituted():
    neg = PromptBuilder.build_negative_prompt("extra thing")
    assert "extra thing" in neg
    assert vocab.NEGATIVE_TERMS[0].lower() in neg.lower()


def test_modules_used_records_provenance():
    r = PromptBuilder.build_product_showcase(_spec(user_prompt="warm light"), None)
    assert "product_preservation" in r.modules_used
    assert "user_intent" in r.modules_used
    # a module with nothing to say is not recorded
    r2 = PromptBuilder.build_product_showcase(_spec(user_prompt=""), None)
    assert "user_intent" not in r2.modules_used


def test_product_3d_carries_its_own_system_prompt_and_no_photography_direction():
    r = PromptBuilder.build_product_3d(
        Product3DSpec(quality="high", texture_resolution="4K", product_description=""))
    assert r.system_prompt == vocab.PRODUCT_3D_SYSTEM_PROMPT
    assert "senior 3D artist" in r.system_prompt
    assert "watertight" in r.system_prompt.lower()
