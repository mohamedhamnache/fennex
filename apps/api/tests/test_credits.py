from app.core.credits import (
    AI_KINDS,
    CREDIT_MICROS,
    PLAN_CREDITS,
    SEO_CREDIT_WEIGHT,
    SEO_PLAN_CREDITS,
    credit_allowance,
    credits_from_micros,
    seo_credit_allowance,
    seo_credits_for,
)


def test_ai_credit_unit_is_unchanged():
    """The credit unit users already see must not shift under them."""
    assert CREDIT_MICROS == 1_050


def test_credits_from_micros_rounds_up_so_small_calls_still_charge():
    assert credits_from_micros(0) == 0
    assert credits_from_micros(-5) == 0
    assert credits_from_micros(1_050) == 1
    # a sub-credit call still costs one credit rather than rounding to zero
    assert credits_from_micros(1) == 1
    # a $0.06 image -> 60_000 micros -> ceil(60_000 / 1_050)
    assert credits_from_micros(60_000) == 58


def test_ai_bucket_covers_llm_image_and_edit_but_not_seo():
    assert set(AI_KINDS) == {"llm", "image", "edit"}
    assert "seo" not in AI_KINDS


def test_credit_allowance_falls_back_to_free():
    assert credit_allowance("starter") == PLAN_CREDITS["starter"]
    assert credit_allowance("nonsense") == PLAN_CREDITS["free"]
    assert credit_allowance("") == PLAN_CREDITS["free"]
    assert credit_allowance(None) == PLAN_CREDITS["free"]


def test_seo_credits_weighted_by_unit():
    assert seo_credits_for("serp", 3) == 3
    assert seo_credits_for("audit", 2) == 2 * SEO_CREDIT_WEIGHT["audit"]
    assert seo_credits_for("backlinks", 1) == SEO_CREDIT_WEIGHT["backlinks"]
    # unknown or missing unit falls back to 1x
    assert seo_credits_for("something_new", 4) == 4
    assert seo_credits_for(None, 5) == 5
    assert seo_credits_for("serp", 0) == 0


def test_seo_credit_allowance_falls_back_to_free():
    assert seo_credit_allowance("pro") == SEO_PLAN_CREDITS["pro"]
    assert seo_credit_allowance("nonsense") == SEO_PLAN_CREDITS["free"]


def test_every_sellable_tier_has_an_explicit_allowance():
    """A tier missing from these dicts silently resolves to the free allowance.

    That is invisible until hard-stop enforcement is live, at which point the
    tier gets 429'd almost immediately -- which is exactly what happened to
    `enterprise`. Pin every PlanTier so a newly added tier fails here instead.
    """
    from app.models.organization import PlanTier

    for tier in PlanTier:
        assert tier.value in PLAN_CREDITS, f"{tier.value} missing from PLAN_CREDITS"
        assert tier.value in SEO_PLAN_CREDITS, f"{tier.value} missing from SEO_PLAN_CREDITS"
        # and it must not silently resolve to the free bucket
        if tier.value != "free":
            assert credit_allowance(tier.value) != PLAN_CREDITS["free"]
            assert seo_credit_allowance(tier.value) != SEO_PLAN_CREDITS["free"]


def test_plan_cogs_stays_within_margin_target():
    """Both buckets together must stay well under a third of the plan price.

    AI: credits * $0.00105. SEO: credits * ~$0.002 per DataForSEO task.
    """
    from app.core.billing import PLAN_PRICE_USD

    for tier in ("starter", "pro", "agency", "scale"):
        cogs = PLAN_CREDITS[tier] * 0.00105 + SEO_PLAN_CREDITS[tier] * 0.002
        assert cogs <= PLAN_PRICE_USD[tier] * 0.32, (tier, cogs)
