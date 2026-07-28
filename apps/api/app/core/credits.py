"""Credit conversions. Money is micro-dollars ($1 = 1_000_000).

Two user-facing buckets:

* **AI credits** -- priced from real supplier cost at ``1 credit == $0.00105``
  (:data:`CREDIT_MICROS`), then **accumulated into the
  ``OrgUsage.ai_credits_used`` counter**, one charge per operation. They are NOT
  derived from accumulated cost at read time: Replicate operations carry a
  pricing floor (:func:`replicate_operation_credits`), which cannot be expressed
  as a function of a summed total. The AI bucket covers ``usage_events.kind`` in
  :data:`AI_KINDS`.

  **If you add a writer for an AI_KINDS event, it MUST bump
  ``ai_credits_used`` as well as ``ai_cost_micros``** -- bumping only the cost
  records the spend but bills the customer nothing.

  ``cost_micros``/``ai_cost_micros`` always hold the TRUE unfloored supplier
  cost, because COGS and margin reporting read them. The floor lives only in the
  billed counter, so a markup never masquerades as cost.
* **SEO credits** -- charged per DataForSEO task, weighted per unit
  (:data:`SEO_CREDIT_WEIGHT`) against that unit's real supplier cost. Counted
  rather than derived, because "tasks" is the unit both users and DataForSEO
  bill in.
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
    # Enterprise is custom-priced and absent from PLAN_PRICE_USD. It still needs
    # an explicit entry: the allowance lookup falls back to `free`, so without
    # one an enterprise org would be hard-stopped after ~$0.21 of spend.
    "enterprise": 500_000,
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
# Replicate pricing floor (billing v2, 2026-07-28)
# --------------------------------------------------------------------------

MIN_REPLICATE_CREDITS = 10  # pricing floor: a Replicate edit never bills less


def replicate_operation_credits(cost_micros: int) -> int:
    """Credits billed for ONE Replicate prediction: the cost-derived amount,
    floored.

    Only Replicate ("edit" kind) operations get this floor -- several of the
    cheaper community models cost a few GPU-seconds, well under one credit's
    worth. A free/zero-cost run bills nothing; anything that cost real money
    bills at least MIN_REPLICATE_CREDITS. LLM and image credits are NOT
    floored (see record_llm/record_image in app/services/metering/meter.py).
    """
    if cost_micros <= 0:
        return 0
    return max(MIN_REPLICATE_CREDITS, credits_from_micros(cost_micros))


# --------------------------------------------------------------------------
# SEO credits (counted per DataForSEO task)
# --------------------------------------------------------------------------

# Credits billed per DataForSEO task, by unit. A SERP lookup is the reference
# operation at 2 credits; the rest are priced relative to it and to their real
# supplier cost (keyword_ideas costs ~13x a SERP task, hence 15).
SEO_CREDIT_WEIGHT: dict[str, int] = {
    "serp": 2,
    # rank_check runs through the same fetch_serp chokepoint as `serp`, so it
    # is the same underlying task and must bill the same.
    "rank_check": 2,
    "keyword_ideas": 15,
    "backlinks": 5,
    "audit": 10,
    # No live call site yet; left at the historical weight until one exists.
    "keyword_analysis": 1,
}

SEO_PLAN_CREDITS: dict[str, int] = {
    "free": 20,
    "starter": 300,
    "pro": 1_500,
    "agency": 4_000,
    "scale": 12_000,
    # See the note on PLAN_CREDITS["enterprise"].
    "enterprise": 50_000,
}


def seo_credits_for(unit: str | None, count: int) -> int:
    """Credits consumed by `count` DataForSEO tasks of type `unit`."""
    if count <= 0:
        return 0
    return count * SEO_CREDIT_WEIGHT.get(unit or "", 1)


def seo_credit_allowance(plan_tier: str) -> int:
    """Monthly SEO credit allowance for a tier, falling back to the smallest."""
    return SEO_PLAN_CREDITS.get(str(plan_tier or "").lower(), SEO_PLAN_CREDITS["free"])
