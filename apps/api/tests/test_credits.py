import pytest
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
    # a SERP lookup is the reference SEO operation at 2 credits
    assert seo_credits_for("serp", 1) == 3    # 3 credits per 10-result page
    assert seo_credits_for("serp", 3) == 9    # 3 pages
    # Pinned to literals, not SEO_CREDIT_WEIGHT[...]: a self-referential
    # assertion passes at any weight and cannot detect a reprice that misses
    # a call site.
    assert seo_credits_for("audit", 2) == 20
    assert seo_credits_for("audit", 1) == 10
    assert seo_credits_for("backlinks", 1) == 5
    assert seo_credits_for("keyword_ideas", 1) == 30
    assert seo_credits_for("rank_check", 1) == 3   # same per-page basis as serp
    # unknown or missing unit falls back to 1x
    assert seo_credits_for("something_new", 4) == 4
    assert seo_credits_for(None, 5) == 5
    assert seo_credits_for("serp", 0) == 0


def test_replicate_operation_credits_floors_cheap_predictions():
    """The 10-credit floor applies ONLY to Replicate ('edit' kind)
    operations -- a real-esrgan/codeformer-class call is a few GPU-seconds
    (well under one credit's worth of cost) but must still bill the floor."""
    from app.core.credits import MIN_REPLICATE_CREDITS, replicate_operation_credits

    assert MIN_REPLICATE_CREDITS == 10
    assert replicate_operation_credits(0) == 0
    assert replicate_operation_credits(-5) == 0
    # 2_000 micros -> credits_from_micros gives 2, floored up to 10
    assert replicate_operation_credits(2_000) == 10
    # 60_000 micros -> credits_from_micros gives 58, already above the floor
    assert replicate_operation_credits(60_000) == 58


def test_seo_credit_allowance_falls_back_to_free():
    assert seo_credit_allowance("pro") == SEO_PLAN_CREDITS["pro"]
    assert seo_credit_allowance("nonsense") == SEO_PLAN_CREDITS["free"]


def test_every_sellable_tier_has_an_explicit_allowance():
    """A tier missing from these dicts silently resolves to the free allowance.

    That is invisible until hard-stop enforcement is live, at which point the
    tier gets 429'd almost immediately -- which is exactly what happened to
    `enterprise`. Pin every PlanTier so a newly added tier fails here instead.

    PLAN_LIMITS is included deliberately: `enterprise` was missing from it too,
    capping a custom-contract customer at the free tier's 1 project.
    """
    from app.core.billing import PLAN_LIMITS
    from app.models.organization import PlanTier

    for tier in PlanTier:
        assert tier.value in PLAN_CREDITS, f"{tier.value} missing from PLAN_CREDITS"
        assert tier.value in SEO_PLAN_CREDITS, f"{tier.value} missing from SEO_PLAN_CREDITS"
        assert tier.value in PLAN_LIMITS, f"{tier.value} missing from PLAN_LIMITS"
        # and it must not silently resolve to the free bucket
        if tier.value != "free":
            assert credit_allowance(tier.value) != PLAN_CREDITS["free"]
            assert seo_credit_allowance(tier.value) != SEO_PLAN_CREDITS["free"]
            assert PLAN_LIMITS[tier.value] != PLAN_LIMITS["free"]


def test_allowances_increase_monotonically_up_the_ladder():
    """A higher tier must never grant fewer credits than a lower one.

    Rescaling the sold tiers once left `enterprise` -- which sits outside the
    ladder because it is custom-priced -- below `scale`.
    """
    ladder = ("free", "starter", "pro", "agency", "scale", "enterprise")
    for lower, higher in zip(ladder, ladder[1:]):
        assert PLAN_CREDITS[higher] > PLAN_CREDITS[lower], f"AI: {higher} <= {lower}"
        assert SEO_PLAN_CREDITS[higher] > SEO_PLAN_CREDITS[lower], f"SEO: {higher} <= {lower}"


def test_byok_exemption_is_limited_to_agency_and_scale():
    """BYOK waives the credit hard-stop, but only on the tiers it is sold on,
    and only for the "ai" bucket.

    Otherwise setting byok_enabled on a Starter org would waive billing
    entirely. Enforcement only -- usage is still metered either way.
    """
    from app.core.billing import byok_exempt_from_credits
    from app.models.organization import Organization, PlanTier

    def org(tier, byok):
        return Organization(name="t", slug="t", plan_tier=tier, byok_enabled=byok)

    assert byok_exempt_from_credits(org(PlanTier.AGENCY, True), "ai") is True
    assert byok_exempt_from_credits(org(PlanTier.SCALE, True), "ai") is True
    # sold-on tiers only
    assert byok_exempt_from_credits(org(PlanTier.STARTER, True), "ai") is False
    assert byok_exempt_from_credits(org(PlanTier.PRO, True), "ai") is False
    assert byok_exempt_from_credits(org(PlanTier.FREE, True), "ai") is False
    # and the flag is required, not just the tier
    assert byok_exempt_from_credits(org(PlanTier.AGENCY, False), "ai") is False
    assert byok_exempt_from_credits(org(PlanTier.SCALE, False), "ai") is False


def test_byok_exemption_never_applies_to_seo_bucket():
    """Worker SEO calls always run on Fennex's own DataForSEO account (there is
    no per-org BYOK resolver for SEO, unlike LLM/image), so a BYOK agency/scale
    org must still be enforced on the "seo" bucket even though it is exempt on
    "ai".
    """
    from app.core.billing import byok_exempt_from_credits
    from app.models.organization import Organization, PlanTier

    def org(tier, byok):
        return Organization(name="t", slug="t", plan_tier=tier, byok_enabled=byok)

    assert byok_exempt_from_credits(org(PlanTier.AGENCY, True), "seo") is False
    assert byok_exempt_from_credits(org(PlanTier.SCALE, True), "seo") is False


def test_paid_tiers_resolve_from_the_enum_member_not_just_the_string():
    """Guards the PlanTier str-enum trap end to end.

    `PlanTier` subclasses `str`, so `isinstance(tier, str)` is always true and
    `str(PlanTier.PRO)` is `"PlanTier.PRO"`. Any caller that forwards the enum
    member without extracting `.value` silently bills a paid org against the
    free allowance.
    """
    from app.core.billing import _tier_value
    from app.models.organization import Organization, PlanTier

    org = Organization(name="t", slug="t", plan_tier=PlanTier.PRO)
    assert _tier_value(org) == "pro"
    assert credit_allowance(_tier_value(org)) == PLAN_CREDITS["pro"]
    # and a plain string tier still works
    org.plan_tier = "agency"
    assert _tier_value(org) == "agency"
    assert credit_allowance(_tier_value(org)) == PLAN_CREDITS["agency"]


# Supplier cost per DataForSEO task, for the margin guard below. serp and
# keyword_ideas are the real seeded rates; backlinks/audit are the placeholder
# rates from migration s8seorates01 and should be corrected together with it.
SEO_UNIT_COST_USD = {
    "serp": 0.0015,
    "rank_check": 0.0015,
    "keyword_ideas": 0.0200,
    "backlinks": 0.0030,
    "audit": 0.0050,
}


def test_plan_cogs_stays_within_margin_target():
    """Both buckets together must stay under a third of the plan price.

    The SEO figure is DERIVED from the unit with the worst cost-per-credit
    rather than hardcoded, so repricing a unit without adjusting its weight
    fails here instead of silently eroding margin. (A hardcoded $0.002/credit
    went stale the moment units started costing more than one credit.)
    """
    from app.core.billing import PLAN_PRICE_USD

    worst_seo_cost_per_credit = max(
        cost / SEO_CREDIT_WEIGHT[unit] for unit, cost in SEO_UNIT_COST_USD.items()
    )
    # keyword_ideas: $0.02 over 20 credits. It was 15 -- the only SEO unit
    # priced BELOW its own supplier cost (19.05 credits of cost at
    # CREDIT_MICROS) while every other unit billed 1.4x-2.1x. Repriced
    # 2026-08-06; the assertion tracks the constant so a future reprice that
    # drops a unit back under cost fails here.
    assert abs(worst_seo_cost_per_credit - 0.02 / 30) < 1e-9

    # No SEO unit may be sold below what it costs to buy.
    for unit, cost in SEO_UNIT_COST_USD.items():
        parity = cost / 0.00105
        assert SEO_CREDIT_WEIGHT[unit] >= parity, (
            f"{unit} bills {SEO_CREDIT_WEIGHT[unit]} credits but costs {parity:.2f}"
        )

    for tier in ("starter", "pro", "agency", "scale"):
        cogs = (
            PLAN_CREDITS[tier] * 0.00105
            + SEO_PLAN_CREDITS[tier] * worst_seo_cost_per_credit
        )
        assert cogs <= PLAN_PRICE_USD[tier] * 0.32, (tier, cogs)


@pytest.mark.xfail(strict=True, reason=(
    "SCALE IS LOSS-MAKING ON SCHEDULED TRACKING, awaiting a product decision. "
    "At 1,000 tracked keywords x 50 projects, weekly, at depth 20, the cron "
    "costs $866/month against a $799 plan -- 108% of revenue before the "
    "customer does anything. Every other tier is 30-44% and fine. Three levers, "
    "all commercial: drop CRON_SERP_DEPTH to 10 (-> $433, 54%), move the cadence "
    "to fortnightly (same effect), or cut Scale's project or keyword cap. "
    "Doing two of the three brings it to ~27%."
))
def test_scheduled_tracking_cost_stays_within_plan_margin():
    """Cron spend is guaranteed COGS and must not stay invisible.

    Rank tracking runs weekly with bill_credits=False: metered for cost, never
    charged. That is deliberate -- a cron fan-out must not exhaust the bucket
    the customer's own work draws on -- but it means every plan carries
    supplier cost before the customer does anything.

    The number that drives it is TRACKED_CAP (per project), NOT
    PLAN_LIMITS[tier]["keywords"], which caps keyword RESEARCH results. An
    earlier version of this test used the latter and overstated the exposure by
    three orders of magnitude.

    DataForSEO bills $0.002 per 10-result page; the cron asks for depth 20.
    """
    from app.core.billing import PLAN_LIMITS, PLAN_PRICE_USD
    from app.services.rank_tracking_service import tracked_cap_for, CRON_SERP_DEPTH

    pages = max(1, -(-CRON_SERP_DEPTH // 10))

    for tier in ("starter", "pro", "agency", "scale"):
        projects = PLAN_LIMITS[tier]["projects"]
        if projects < 0:
            continue                                       # contract-priced
        monthly = tracked_cap_for(tier) * pages * 0.002 * 4.33 * projects
        share = monthly / PLAN_PRICE_USD[tier]
        assert share <= 0.50, (
            f"{tier}: scheduled tracking is {share:.0%} of plan price "
            f"(${monthly:.2f} of ${PLAN_PRICE_USD[tier]}) before the customer "
            f"does anything. Lower the tracked-keyword cap, cut the cadence, "
            f"or reduce CRON_SERP_DEPTH."
        )


def test_an_unlimited_keyword_cap_would_make_cron_cost_unbounded():
    """Enterprise sets keywords to -1 (unlimited). Scheduled tracking then has
    no ceiling at all, so its cost cannot be bounded by the plan the way every
    other tier is. Contract-priced by definition -- this records why that is
    load-bearing rather than incidental."""
    from app.core.billing import PLAN_LIMITS

    assert PLAN_LIMITS["enterprise"]["keywords"] == -1
