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
    "starter": 3_000,
    "pro": 10_000,
    "agency": 30_000,
    "scale": 70_000,
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


def feature_min_credits(feature: str | None) -> int:
    """Credit floor for one invocation of a named feature, or 0 for no floor.

    Same principle as :data:`MIN_REPLICATE_CREDITS`, applied to LLM features
    whose supplier cost is far below what the action is worth to sell. A
    rephrase costs well under a credit of tokens but is a deliberate button
    press that delivers a discrete result, so it is priced as an operation
    rather than at cost.

    Like the Replicate floor, this touches ONLY the billed counter.
    ``cost_micros`` keeps the true, unfloored supplier cost, so COGS and margin
    reporting stay honest and the markup never masquerades as cost.
    """
    return FEATURE_MIN_CREDITS.get(feature or "", 0)


# Per-feature credit floors. Keyed by the `feature` string passed to
# record_llm, so the floor holds no matter which call path did the metering --
# including the ambient path, where no call site passes a meter explicitly.
FEATURE_MIN_CREDITS: dict[str, int] = {
    # apps/api/app/api/v1/routers/images.py::_IMPROVE_FEATURE
    "improve_prompt": MIN_REPLICATE_CREDITS,
}


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
    # PER 10-RESULT PAGE, not per request -- DataForSEO bills that way and
    # fetch_serp passes count=pages. A page costs 2,000 micro-$ (1.90 credits),
    # so 3 keeps the same 1.4x-2.1x band every other unit sits in. The old
    # weight of 2 was right for one page and wrong for the ten a depth-100
    # request actually buys, which is how serp came to be sold at a tenth of
    # cost.
    "serp": 3,
    # rank_check runs through the same fetch_serp chokepoint as `serp`, so it
    # is the same underlying task and must bill the same.
    "rank_check": 3,
    # Standard queue: $0.0006 per page against Live's $0.002. Same 1.5x-ish
    # markup band, on a third of the cost.
    "serp_standard": 1,
    "rank_check_standard": 1,
    # 20,000 micro-$ per task = 19.05 credits of cost at CREDIT_MICROS. Was 15,
    # the only SEO unit priced BELOW its own supplier cost while every other
    # billed 1.4x-2.1x. Measured 2026-08-06; see migration u7seoprice3.
    # 20,000 micro-$ per task = 19.05 credits of cost. 20 only cleared parity
    # (1.05x) while every other unit billed 1.4x-2.1x; 30 puts it in the same
    # band. Reseller margin comes from this multiple, not from the allowance.
    "keyword_ideas": 30,
    "backlinks": 5,
    "audit": 10,
    # No live call site, and no seeded cost_rate either -- so its cost is
    # invisible and its price arbitrary. Left in place deliberately: removing the
    # key would make seo_credits_for() fall back to a weight of 1 for it anyway,
    # which is the same number with less of a paper trail. Seed a rate BEFORE
    # wiring a caller.
    "keyword_analysis": 1,
}

# Scaled 5x alongside the per-unit reprice (serp 1->2, keyword_ideas 1->15,
# etc). Without this the weight increase would have silently cut entitlements
# by the same factor -- Starter's keyword research would have gone from 300
# runs a month to 20.
SEO_PLAN_CREDITS: dict[str, int] = {
    "free": 100,
    "starter": 1_000,
    "pro": 3_000,
    "agency": 8_000,
    "scale": 15_000,
    # See the note on PLAN_CREDITS["enterprise"]. Must stay above `scale`.
    "enterprise": 250_000,
}


def seo_credits_for(unit: str | None, count: int) -> int:
    """Credits consumed by `count` DataForSEO tasks of type `unit`."""
    if count <= 0:
        return 0
    return count * SEO_CREDIT_WEIGHT.get(unit or "", 1)


def seo_credit_allowance(plan_tier: str) -> int:
    """Monthly SEO credit allowance for a tier, falling back to the smallest."""
    return SEO_PLAN_CREDITS.get(str(plan_tier or "").lower(), SEO_PLAN_CREDITS["free"])
