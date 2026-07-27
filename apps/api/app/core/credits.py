"""AI credits: the user-facing unit that hides model economics.

A credit is a fixed amount of cost of goods, not a request. Because
``usage_events.cost_micros`` is already priced from each model's own
``cost_rates`` rows and its real token counts, credits are simply cost divided
by the credit unit -- there is no multiplier table to maintain or to drift when
a model is repriced.

The published ratios fall out of that automatically. At a reference request of
3k input and 1k output tokens against the seeded rates:

    gpt-4o-mini (cheap, OpenAI)      $0.00105    1.0 credit
    claude-haiku-4-5 (cheap, fallback) $0.00800   7.6 credits
    gpt-4o (standard, OpenAI)        $0.01750   16.7 credits
    claude-sonnet-5 (standard, fallback) $0.02400 22.9 credits
    claude-opus-5 (premium)          $0.04000   38.1 credits

Two properties worth keeping in mind. Charging by cost rather than per request
means a large cheap call costs more credits than a small one, which is correct:
a 10k-token summarisation is not the same product as a 500-token tag. And a
failover to the Anthropic side of a band charges its real 7.6x, so an outage
cannot quietly erode margin at the same credit price.

Allowances are sized so that spending an entire month's credits on the most
expensive band a plan can reach still leaves at least the 400% markup the
reseller spec requires. See tests/test_credits.py, which asserts that floor.
"""

# Cost of the reference cheap request above, in micro-dollars ($1 = 1_000_000).
# This is the definition of one credit; changing it repricess every plan, so it
# is asserted against the plan allowances in the tests.
CREDIT_MICROS = 1_050

# Monthly credit allowance per plan tier. "free" is retained for orgs already on
# it and is deliberately small; it is no longer sold.
PLAN_CREDITS: dict[str, int] = {
    "free": 200,
    "starter": 5_000,
    "pro": 18_000,
    "agency": 55_000,
    "scale": 150_000,
}


def credits_from_micros(cost_micros: int) -> int:
    """Convert metered cost into whole credits, rounding up.

    Rounding up means any billable work costs at least one credit, so a burst of
    very small calls cannot consume real cost while registering as zero.
    """
    if cost_micros <= 0:
        return 0
    return -(-int(cost_micros) // CREDIT_MICROS)


def credit_allowance(plan_tier: str) -> int:
    """Monthly allowance for a tier, falling back to the smallest bucket for an
    unrecognised tier rather than granting an unlimited one."""
    return PLAN_CREDITS.get(str(plan_tier or "").lower(), PLAN_CREDITS["free"])
