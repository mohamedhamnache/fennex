"""Credit conversions. Money is micro-dollars ($1 = 1_000_000).

1 AI credit == $0.01 of real supplier cost. AI credits are accumulated as
*milli-credits* (credits * 1000) so that sub-cent calls -- a gpt-4o-mini turn
costs ~$0.002, i.e. 0.2 credits -- accumulate exactly instead of rounding to
zero on every call. Display divides by 1000.

1 SEO credit == one DataForSEO billable task; heavier endpoints are weighted.
"""

AI_CREDIT_MICROS = 10_000  # $0.01 per AI credit


def ai_credits_from_micros(cost_micros: int) -> int:
    """Convert supplier cost (micro-dollars) to milli-credits."""
    return round(cost_micros * 1000 / AI_CREDIT_MICROS)


def milli_to_credits(milli: int) -> int:
    """Whole credits for display/enforcement."""
    return round(milli / 1000)


SEO_CREDIT_WEIGHT: dict[str, int] = {
    "serp": 1,
    "keyword_ideas": 1,
    "keyword_analysis": 1,
    "rank_check": 1,
    "backlinks": 3,
    "audit": 5,
}


def seo_credits_for(unit: str | None, count: int) -> int:
    return count * SEO_CREDIT_WEIGHT.get(unit or "", 1)


# Backward compatibility: old functions used by other modules
CREDIT_MICROS = 1_050

PLAN_CREDITS: dict[str, int] = {
    "free": 200,
    "starter": 5_000,
    "pro": 18_000,
    "agency": 55_000,
    "scale": 150_000,
}


def credits_from_micros(cost_micros: int) -> int:
    """Convert metered cost into whole credits, rounding up."""
    if cost_micros <= 0:
        return 0
    return -(-int(cost_micros) // CREDIT_MICROS)


def credit_allowance(plan_tier: str) -> int:
    """Monthly allowance for a tier, falling back to the smallest bucket."""
    return PLAN_CREDITS.get(str(plan_tier or "").lower(), PLAN_CREDITS["free"])
