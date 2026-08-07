"""The invariants the campaign OS is built on.

Each test here guards a claim the product makes to a merchant about money. They
are not coverage: they are the specific ways this feature could lie.
"""
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from app.models.campaign import Campaign
from app.models.store_order import StoreOrder
from app.services import campaign_metrics, campaign_tracking
from app.services.campaign_experiments import MIN_TRIALS_PER_SIDE, significance


def _order(slug_query: str, price: float, when: datetime) -> StoreOrder:
    return StoreOrder(project_id=uuid.uuid4(), org_id=uuid.uuid4(), external_id="1",
                      total_price=price, currency="EUR", ordered_at=when,
                      landing_site=f"https://shop.example/p?{slug_query}")


# ── attribution ───────────────────────────────────────────────────────────────

def test_campaign_tag_match_is_exact_not_prefix():
    """"summer" must not collect "summer-launch"'s orders.

    The tag lives in a query string inside a 2000-char column, so the tempting
    implementation is a SQL LIKE. That would merge two campaigns' revenue
    silently, and no later analysis could separate them.
    """
    assert campaign_metrics.campaign_of("https://s.com/p?utm_campaign=summer-launch") == "summer-launch"
    assert campaign_metrics.campaign_of("https://s.com/p?utm_campaign=summer") == "summer"
    assert campaign_metrics.campaign_of("https://s.com/p?utm_campaign=summer-launch") != "summer"


def test_untagged_order_attributes_to_nothing():
    assert campaign_metrics.campaign_of("https://s.com/p") is None
    assert campaign_metrics.campaign_of(None) is None
    assert campaign_metrics.campaign_of("") is None


def test_campaign_with_no_slug_earns_nothing():
    """A campaign whose tag was never on a live link cannot claim revenue."""
    c = Campaign(org_id=uuid.uuid4(), project_id=uuid.uuid4(), goal="g", slug=None,
                 starts_on=date.today())
    assert c.slug is None   # the guard `attributed_orders` reads first


def test_window_excludes_a_campaign_that_never_launched():
    """No start date and no launch means an empty window, not "all of history"."""
    c = Campaign(org_id=uuid.uuid4(), project_id=uuid.uuid4(), goal="g", slug="x",
                 starts_on=None, launched_at=None)
    start, end = campaign_metrics._window(c, date(2026, 8, 7))
    assert start > end, "a campaign that never launched must have an empty window"


# ── the numbers we refuse to produce ──────────────────────────────────────────

def test_unavailable_metrics_carry_no_value():
    """`unavailable` names metrics. It must never carry a figure.

    A caveat is a sentence a model or a reader can drop. A missing value is not.
    """
    rows = [{"metric": k, "needs": v} for k, v in campaign_metrics.UNAVAILABLE_SOURCE.items()]
    for row in rows:
        assert set(row) == {"metric", "needs"}, f"{row} leaked a value"


def test_roas_and_cac_are_never_computed():
    """Both need spend, which no connected system reports."""
    for metric in ("roas", "cac", "spend", "ctr", "cpc", "impressions"):
        assert metric in campaign_metrics.UNAVAILABLE_SOURCE


@pytest.mark.asyncio
async def test_performance_payload_has_no_roas_key(monkeypatch):
    """The one that matters: whatever else the payload gains, it must never
    grow a `roas` field. Budget is planned, spend is taken, and a ratio of
    revenue to budget rendered under the name ROAS is the exact mistake this
    module exists to prevent."""
    c = Campaign(id=uuid.uuid4(), org_id=uuid.uuid4(), project_id=uuid.uuid4(),
                 goal="g", slug="tagged", starts_on=date.today(),
                 budget_amount=500, budget_currency="EUR", targets={"revenue": 1000})

    async def no_orders(campaign, db):
        return []
    monkeypatch.setattr(campaign_metrics, "attributed_orders", no_orders)

    payload = await campaign_metrics.for_campaign(c, db=None)
    assert "roas" not in payload and "cac" not in payload and "spend" not in payload
    assert "revenue_vs_budget" in payload
    assert {u["metric"] for u in payload["unavailable"]} >= {"roas", "cac", "spend"}


# ── tracking ──────────────────────────────────────────────────────────────────

def test_tag_url_overwrites_a_foreign_campaign_tag():
    """A link pasted from elsewhere carries that campaign's tags.

    Preserving them would attribute this campaign's orders to that one.
    """
    out = campaign_tracking.tag_url(
        "https://shop.example/p?ref=x&utm_campaign=someone-else",
        campaign="ours", source="instagram", medium="social")
    assert "utm_campaign=ours" in out
    assert "someone-else" not in out
    assert "ref=x" in out, "non-UTM parameters must survive"


def test_slugify_is_ascii_only():
    """A UTM value with accents is percent-encoded differently by different
    platforms and stops matching itself."""
    slug = campaign_tracking.slugify("Été: Lancement Produit #1 !!")
    assert slug == "ete-lancement-produit-1"
    assert slug.isascii()


# ── experiments ───────────────────────────────────────────────────────────────

def test_small_sample_has_no_winner():
    """3 conversions against 2 is not a 50% improvement."""
    winner, confidence = significance(2, 40, 3, 40)
    assert winner is None


def test_below_minimum_trials_reports_nothing_at_all():
    """The normal approximation is not trustworthy on a handful of trials, so a
    high confidence there would be worse than no verdict."""
    winner, confidence = significance(5, MIN_TRIALS_PER_SIDE - 1, 15, MIN_TRIALS_PER_SIDE - 1)
    assert winner is None and confidence == 0.0


def test_a_real_difference_settles():
    winner, confidence = significance(50, 1000, 80, 1000)
    assert winner == "B" and confidence >= 0.95


def test_no_variance_produces_no_winner():
    """Everyone converted, or nobody did. There is no difference to detect."""
    assert significance(40, 40, 40, 40)[0] is None
    assert significance(0, 40, 0, 40)[0] is None


# ── audiences ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_audience_size_is_never_estimated():
    """Fennex holds no customer records, so any size would be invented -- and it
    is the one figure a merchant sizes their budget against."""
    from app.services import campaign_audience

    for preset in campaign_audience.presets():
        assert "size" not in preset or preset["size"] is None


def test_audience_rule_drops_unknown_fields():
    """A rule carrying a field the destination platform never heard of fails
    silently there, which looks like a campaign that reached nobody."""
    from app.services.campaign_audience import _clean_rule

    cleaned = _clean_rule({"all": [
        {"field": "total_spent", "op": ">=", "value": 150},
        {"field": "favourite_colour", "op": "=", "value": "blue"},
        {"field": "orders_count", "op": "BLAST", "value": 1},
    ]})
    assert cleaned == {"all": [{"field": "total_spent", "op": ">=", "value": 150}]}


# ── channels ──────────────────────────────────────────────────────────────────

def test_every_channel_connector_exists_in_the_mcp_catalogue():
    """Validated at import, asserted here so the reason survives a refactor:
    a typo becomes a channel nobody can ever satisfy, and the merchant reads
    "connect meta_ads" forever while the catalogue calls it "meta-ads"."""
    from app.employees.runtime import mcp
    from app.services.campaign_channels import CHANNELS

    for c in CHANNELS.values():
        for app_key in c.connector_apps:
            assert app_key in mcp.CATALOGUE, f"{c.key} declares unknown {app_key}"


def test_a_channel_with_no_connector_is_marked_manual():
    """Otherwise it silently becomes a channel that can never be executed and
    never explains why."""
    from app.services.campaign_channels import CHANNELS

    for c in CHANNELS.values():
        assert c.connector_apps or c.manual_only, f"{c.key} is unreachable and unlabelled"


def test_paid_channels_require_spend_approval():
    """Money leaving the account is always gated."""
    from app.services.campaign_channels import ACT_SPEND, CHANNELS

    for c in CHANNELS.values():
        if c.spends_money:
            assert ACT_SPEND in c.approvals, f"{c.key} spends money without an approval gate"


# ── templates ─────────────────────────────────────────────────────────────────

def test_templates_carry_no_merchant_specifics():
    """A template that guesses a budget or a product produces a campaign that is
    subtly about someone else's shop."""
    from app.services.campaign_templates import TEMPLATES

    for t in TEMPLATES.values():
        assert not hasattr(t, "budget")
        assert not hasattr(t, "products")


def test_template_timelines_are_relative_to_launch():
    """Absolute dates would not survive being applied to a different start."""
    from app.services.campaign_templates import TEMPLATES

    for t in TEMPLATES.values():
        for offset, title, _owner in t.timeline:
            assert isinstance(offset, int)
            assert title
