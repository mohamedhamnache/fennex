"""Credit conversions. Money is micro-dollars ($1 = 1_000_000).

Two user-facing buckets:

* **AI credits** -- derived from real supplier cost. ``1 credit == $0.00105``
  (:data:`CREDIT_MICROS`). Credits are never stored: they are computed from the
  period's accumulated AI cost via :func:`credits_from_micros`, so adding a new
  cost source (image generation, Replicate) automatically consumes credits with
  no schema change. The AI bucket covers ``usage_events.kind`` in
  :data:`AI_KINDS`.
* **SEO credits** -- one DataForSEO billable task is one credit, with heavier
  endpoints weighted (:data:`SEO_CREDIT_WEIGHT`). Counted rather than derived,
  because "tasks" is the unit both users and DataForSEO bill in.
"""

# --------------------------------------------------------------------------
# AI credits (derived from cost)
# --------------------------------------------------------------------------

CREDIT_MICROS = 1_050  # $0.00105 of supplier cost per AI credit

PLAN_CREDITS: dict[str, int] = {
    "free": 200,
    "starter": 5_000,
    "pro": 18_000,
    "agency": 55_000,
    "scale": 150_000,
}

# Usage-event kinds whose cost consumes AI credits. 'seo' is deliberately
# excluded -- it has its own bucket.
AI_KINDS = ("llm", "image", "edit")


def credits_from_micros(cost_micros: int) -> int:
    """Convert metered AI cost into whole credits, rounding up."""
    if cost_micros <= 0:
        return 0
    return -(-int(cost_micros) // CREDIT_MICROS)


def credit_allowance(plan_tier: str) -> int:
    """Monthly AI credit allowance for a tier, falling back to the smallest."""
    return PLAN_CREDITS.get(str(plan_tier or "").lower(), PLAN_CREDITS["free"])


# --------------------------------------------------------------------------
# SEO credits (counted per DataForSEO task)
# --------------------------------------------------------------------------

SEO_CREDIT_WEIGHT: dict[str, int] = {
    "serp": 1,
    "keyword_ideas": 1,
    "keyword_analysis": 1,
    "rank_check": 1,
    "backlinks": 3,
    "audit": 5,
}

SEO_PLAN_CREDITS: dict[str, int] = {
    "free": 20,
    "starter": 300,
    "pro": 1_500,
    "agency": 4_000,
    "scale": 12_000,
}


def seo_credits_for(unit: str | None, count: int) -> int:
    """Credits consumed by `count` DataForSEO tasks of type `unit`."""
    if count <= 0:
        return 0
    return count * SEO_CREDIT_WEIGHT.get(unit or "", 1)


def seo_credit_allowance(plan_tier: str) -> int:
    """Monthly SEO credit allowance for a tier, falling back to the smallest."""
    return SEO_PLAN_CREDITS.get(str(plan_tier or "").lower(), SEO_PLAN_CREDITS["free"])
