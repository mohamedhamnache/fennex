"""Guards the Stripe lookup_key -> plan tier mapping.

The webhook reads a subscription's price lookup_key and maps it to a tier. When
a tier is missing from that map the subscription is created, the customer is
charged, and the org is silently left on its old plan -- no error anywhere. That
happened when the Scale tier was added, so these tests pin the invariant: every
tier the app sells must be reachable from Stripe.
"""
import pytest

from app.api.v1.routers.billing import _PRICE_MAP
from app.api.v1.routers.webhooks import PRICE_TO_TIER, TIER_ORDER
from app.core.billing import PLAN_LIMITS
from app.core.credits import PLAN_CREDITS
from app.models.organization import PlanTier

# Tiers sold through Stripe checkout. "free" is retained for existing orgs and
# "enterprise" is contract-only, so neither needs a price.
SELLABLE = {"starter", "pro", "agency", "scale"}


def test_every_sellable_tier_has_both_lookup_keys():
    """Monthly and annual, or one billing period silently fails to map."""
    for tier in SELLABLE:
        for period in ("monthly", "annual"):
            key = f"{tier}_{period}"
            assert key in PRICE_TO_TIER, f"no lookup key {key} in PRICE_TO_TIER"
            assert PRICE_TO_TIER[key] == tier


def test_checkout_and_webhook_cover_the_same_tiers():
    """A tier you can buy but cannot map is the exact Scale bug: checkout
    succeeds, the customer pays, the plan never changes."""
    checkout_tiers = {tier for tier, _annual in _PRICE_MAP}
    webhook_tiers = set(PRICE_TO_TIER.values())
    assert checkout_tiers == webhook_tiers, (
        f"only in checkout: {checkout_tiers - webhook_tiers}; "
        f"only in webhook: {webhook_tiers - checkout_tiers}"
    )


def test_tier_order_contains_every_tier_that_can_be_set():
    """TIER_ORDER decides upgrade vs downgrade via index. A missing tier gets
    index 0, so moving to it would run the downgrade path and lock resources."""
    for tier in SELLABLE | {"free"}:
        assert tier in TIER_ORDER, f"{tier} missing from TIER_ORDER"


def test_tier_order_is_cheapest_first():
    assert TIER_ORDER.index("free") < TIER_ORDER.index("starter")
    assert TIER_ORDER.index("starter") < TIER_ORDER.index("pro")
    assert TIER_ORDER.index("pro") < TIER_ORDER.index("agency")
    assert TIER_ORDER.index("agency") < TIER_ORDER.index("scale")


@pytest.mark.parametrize("tier", sorted(SELLABLE))
def test_a_sellable_tier_is_wired_end_to_end(tier):
    """Price map, webhook mapping, quotas, credits and the enum must all know
    it -- any one missing breaks a real purchase in a different way."""
    assert (tier, False) in _PRICE_MAP and (tier, True) in _PRICE_MAP
    assert tier in PRICE_TO_TIER.values()
    assert tier in PLAN_LIMITS
    assert tier in PLAN_CREDITS
    assert tier in {t.value for t in PlanTier}


def test_upgrade_and_downgrade_are_distinguishable_for_scale():
    """Scale is the top tier, so every move to it is an upgrade and every move
    off it is a downgrade. Before the fix Scale was absent from TIER_ORDER, so
    an upgrade to it read as index 0 and ran the downgrade path."""
    scale = TIER_ORDER.index("scale")
    assert scale == len(TIER_ORDER) - 1
    assert scale > TIER_ORDER.index("agency")
