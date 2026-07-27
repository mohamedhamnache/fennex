"""Credits are a pricing surface, so these tests pin the money, not the plumbing.

The important one is test_every_plan_clears_the_margin_floor: it fails if anyone
raises an allowance, lowers a price, or changes the credit unit in a way that
would let a customer spend a month's credits and leave less than the 400%
markup the reseller spec requires.
"""
import pytest

from app.core.billing import PLAN_LIMITS
from app.core.credits import (
    CREDIT_MICROS,
    PLAN_CREDITS,
    credit_allowance,
    credits_from_micros,
)

# Monthly list price in dollars, per the reseller plan table.
PLAN_PRICES_USD = {"starter": 29, "pro": 99, "agency": 299, "scale": 799}

# Cost in micro-dollars of one reference request (3k input, 1k output tokens)
# against the seeded cost_rates, per band using the OpenAI primaries.
REFERENCE_REQUEST_MICROS = {
    "cheap": 1_050,      # gpt-4o-mini
    "standard": 17_500,  # gpt-4o
    "premium": 40_000,   # claude-opus-5
}

MIN_MARKUP = 5.0  # 400% margin means price >= 5x cost of goods


def test_one_credit_is_one_reference_cheap_request():
    assert credits_from_micros(REFERENCE_REQUEST_MICROS["cheap"]) == 1


def test_band_ratios_follow_real_model_cost():
    """The published 1x / 17x / 38x ratios must fall out of the rates, not a
    hand-maintained table. If a rate changes these move with it, which is the
    point of deriving credits from cost."""
    assert credits_from_micros(REFERENCE_REQUEST_MICROS["standard"]) == 17
    assert credits_from_micros(REFERENCE_REQUEST_MICROS["premium"]) == 39


def test_a_pricier_fallback_inside_a_band_costs_more_credits():
    """claude-haiku-4-5 is the cheap-band fallback and costs 7.6x gpt-4o-mini.
    Charging it as one credit would let a failover erode margin silently."""
    haiku_micros = 8_000  # 3k in / 1k out at 1.0 / 5.0 micro-$ per token
    assert credits_from_micros(haiku_micros) == 8
    assert credits_from_micros(haiku_micros) > credits_from_micros(
        REFERENCE_REQUEST_MICROS["cheap"]
    )


def test_billable_work_never_rounds_to_zero_credits():
    """Rounding down would let a burst of tiny calls consume real cost while
    registering as free."""
    assert credits_from_micros(1) == 1
    assert credits_from_micros(CREDIT_MICROS - 1) == 1
    assert credits_from_micros(0) == 0
    assert credits_from_micros(-5) == 0


@pytest.mark.parametrize("tier,price", PLAN_PRICES_USD.items())
def test_every_plan_clears_the_margin_floor(tier, price):
    """Spending the whole allowance on the most expensive band a plan can reach
    must still leave a 5x markup."""
    worst_case_cogs_usd = (PLAN_CREDITS[tier] * CREDIT_MICROS) / 1_000_000
    markup = price / worst_case_cogs_usd
    assert markup >= MIN_MARKUP, (
        f"{tier}: {PLAN_CREDITS[tier]} credits cost ${worst_case_cogs_usd:.2f} "
        f"against a ${price} price, a {markup:.1f}x markup, below the "
        f"{MIN_MARKUP}x floor"
    )


def test_allowances_rise_with_price():
    ordered = ["starter", "pro", "agency", "scale"]
    values = [PLAN_CREDITS[t] for t in ordered]
    assert values == sorted(values), f"allowances not monotonic: {values}"


def test_every_sold_plan_has_an_allowance():
    assert set(PLAN_CREDITS) == set(PLAN_LIMITS), (
        "a tier with quotas but no credit allowance would silently fall back to "
        "the free bucket"
    )


def test_unknown_tier_gets_the_smallest_bucket_not_unlimited():
    assert credit_allowance("enterprise-custom") == PLAN_CREDITS["free"]
    assert credit_allowance(None) == PLAN_CREDITS["free"]
