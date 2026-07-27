from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.core import entitlements
from app.models.organization import PlanTier


def _org(plan, flag=False, trial_ends_at=None):
    return SimpleNamespace(plan_tier=plan, premium_models_enabled=flag, trial_ends_at=trial_ends_at)


def test_premium_requires_both_plan_and_flag():
    assert entitlements.max_band(_org(PlanTier.PRO, True)) == "premium"
    assert entitlements.max_band(_org(PlanTier.PRO, False)) == "standard"
    assert entitlements.max_band(_org(PlanTier.STARTER, True)) == "standard"


def test_free_and_starter_never_reach_premium():
    for plan in (PlanTier.FREE, PlanTier.STARTER):
        assert entitlements.max_band(_org(plan, True)) == "standard"


def test_agency_and_enterprise_may_reach_premium():
    for plan in (PlanTier.AGENCY, PlanTier.ENTERPRISE):
        assert entitlements.max_band(_org(plan, True)) == "premium"


def test_plan_tier_accepts_a_plain_string():
    """plan_tier is an enum on the model but a string in some payloads."""
    assert entitlements.max_band(SimpleNamespace(plan_tier="pro", premium_models_enabled=True)) == "premium"


def test_cap_band_clamps_down_and_never_up():
    starter = _org(PlanTier.STARTER, True)
    assert entitlements.cap_band("premium", starter) == "standard"
    assert entitlements.cap_band("cheap", starter) == "cheap"
    pro = _org(PlanTier.PRO, True)
    assert entitlements.cap_band("premium", pro) == "premium"


def test_missing_org_caps_at_standard():
    assert entitlements.max_band(None) == "standard"
    assert entitlements.cap_band("premium", None) == "standard"


def test_in_trial_org_caps_at_standard_even_with_pro_plan_and_flag():
    future = datetime.now(timezone.utc) + timedelta(days=7)
    org = _org(PlanTier.PRO, True, trial_ends_at=future)
    assert entitlements.max_band(org) == "standard"


def test_org_past_trial_reaches_premium():
    past = datetime.now(timezone.utc) - timedelta(days=1)
    org = _org(PlanTier.PRO, True, trial_ends_at=past)
    assert entitlements.max_band(org) == "premium"


def test_org_with_no_trial_reaches_premium():
    org = _org(PlanTier.PRO, True, trial_ends_at=None)
    assert entitlements.max_band(org) == "premium"


def test_naive_trial_ends_at_does_not_raise():
    naive_future = datetime.now() + timedelta(days=7)
    org = _org(PlanTier.PRO, True, trial_ends_at=naive_future)
    assert entitlements.max_band(org) == "standard"

    naive_past = datetime.now() - timedelta(days=1)
    org = _org(PlanTier.PRO, True, trial_ends_at=naive_past)
    assert entitlements.max_band(org) == "premium"


from app.api.v1.routers.organizations import _plan_allows_premium


def test_plan_allows_premium_matches_the_entitlement_rule():
    assert _plan_allows_premium(_org(PlanTier.PRO)) is True
    assert _plan_allows_premium(_org(PlanTier.AGENCY)) is True
    assert _plan_allows_premium(_org(PlanTier.STARTER)) is False
    assert _plan_allows_premium(_org(PlanTier.FREE)) is False


def test_plan_allows_premium_agrees_with_max_band_for_an_in_trial_org():
    """Regression for the toggle lying during a trial: max_band caps an
    in-trial pro org at "standard" regardless of plan/flag, so
    _plan_allows_premium must say False for it too -- otherwise Settings
    reports premium_available=true (toggle switches on, PATCH succeeds) for
    a capability max_band would refuse the moment premium_models_enabled
    were actually set."""
    future = datetime.now(timezone.utc) + timedelta(days=7)
    in_trial_pro = _org(PlanTier.PRO, trial_ends_at=future)
    assert _plan_allows_premium(in_trial_pro) is False
    assert entitlements.max_band(
        SimpleNamespace(plan_tier=in_trial_pro.plan_tier, premium_models_enabled=True,
                        trial_ends_at=in_trial_pro.trial_ends_at)
    ) == "standard"

    past = datetime.now(timezone.utc) - timedelta(days=1)
    past_trial_pro = _org(PlanTier.PRO, trial_ends_at=past)
    assert _plan_allows_premium(past_trial_pro) is True
