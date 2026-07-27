"""Pins the shipped plan quotas to the approved billing v2 plan table
(.superpowers/sdd/2026-07-27-billing-v2-credits/task-6-brief.md).

PLAN_LIMITS is what check_usage_limit enforces, so a silent edit here changes
what paying customers can do. These assertions exist to make such an edit
deliberate rather than incidental.

Billing v2 (task 6, 2026-07-27) tightened these caps -- Starter drops from 3
projects/3 seats to 1/1 -- superseding the original reseller-spec numbers
below. No grandfathering: applies to every org immediately.
"""
import pytest

from app.api.v1.routers.billing import _PRICE_MAP
from app.core.billing import PLAN_LIMITS
from app.models.organization import PlanTier

# resource -> (starter, pro, agency, scale), from the approved billing v2 table.
SPEC_QUOTAS = {
    "projects": (1, 5, 15, 50),
    "seats": (1, 3, 10, 25),
    "articles": (25, 120, 500, -1),
    "images": (40, 200, 800, -1),
    "keywords": (500, 2500, 10000, 40000),
}

PAID_TIERS = ("starter", "pro", "agency", "scale")


@pytest.mark.parametrize("resource,expected", SPEC_QUOTAS.items())
def test_paid_tier_quotas_match_the_spec(resource, expected):
    actual = tuple(PLAN_LIMITS[tier][resource] for tier in PAID_TIERS)
    assert actual == expected, f"{resource}: got {actual}, spec says {expected}"


def test_scale_tier_exists_and_is_sellable():
    """Scale is the new top tier; it must be priced and quota'd, not just named."""
    assert "scale" in PLAN_LIMITS
    assert ("scale", False) in _PRICE_MAP
    assert ("scale", True) in _PRICE_MAP
    assert PlanTier.SCALE.value == "scale"


def test_free_tier_is_retained_unchanged_for_existing_orgs():
    """Free is no longer sold, but orgs already on it must keep working. If this
    fails, those orgs silently gained or lost capability."""
    assert PLAN_LIMITS["free"] == {
        "projects": 1, "articles": 4, "images": 5, "social": 10,
        "keywords": 50, "seats": 1, "brand_voices": 1, "audits": 1, "backlinks": 1,
    }


def test_every_plan_limits_key_is_a_real_plan_tier():
    valid = {t.value for t in PlanTier}
    assert set(PLAN_LIMITS) <= valid, f"unknown tiers: {set(PLAN_LIMITS) - valid}"


def test_every_tier_defines_the_same_resources():
    """A resource missing from one tier raises KeyError inside check_usage_limit
    at request time rather than failing here."""
    resources = {tier: set(limits) for tier, limits in PLAN_LIMITS.items()}
    reference = resources["free"]
    for tier, keys in resources.items():
        assert keys == reference, f"{tier} resources differ: {keys ^ reference}"


def test_paid_tiers_are_monotonic_on_spec_resources():
    """Each paid tier must be at least as generous as the one below it, with -1
    meaning unlimited. A tier that costs more and allows less is a pricing bug."""
    def rank(v: int) -> float:
        return float("inf") if v == -1 else v

    for resource in SPEC_QUOTAS:
        values = [rank(PLAN_LIMITS[t][resource]) for t in PAID_TIERS]
        assert values == sorted(values), f"{resource} is not monotonic: {values}"
