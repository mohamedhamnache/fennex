from app.core.credits import (
    AI_CREDIT_MICROS, ai_credits_from_micros, milli_to_credits,
    seo_credits_for, SEO_CREDIT_WEIGHT,
)


def test_ai_credit_is_one_cent_of_cost():
    assert AI_CREDIT_MICROS == 10_000


def test_ai_credits_from_micros_returns_milli_credits():
    # $0.01 of cost == 1 credit == 1000 milli-credits
    assert ai_credits_from_micros(10_000) == 1_000
    # gpt-image-1 medium, $0.06 -> 6 credits
    assert ai_credits_from_micros(60_000) == 6_000
    # a sub-cent LLM call must NOT round to zero: $0.002 -> 0.2 credits
    assert ai_credits_from_micros(2_000) == 200
    assert ai_credits_from_micros(0) == 0


def test_milli_to_credits_rounds_for_display():
    assert milli_to_credits(1_000) == 1
    assert milli_to_credits(1_600) == 2
    assert milli_to_credits(0) == 0


def test_seo_credits_weighted_by_unit():
    assert seo_credits_for("serp", 3) == 3
    assert seo_credits_for("audit", 2) == 2 * SEO_CREDIT_WEIGHT["audit"]
    # unknown or missing unit falls back to 1x
    assert seo_credits_for("something_new", 4) == 4
    assert seo_credits_for(None, 5) == 5
