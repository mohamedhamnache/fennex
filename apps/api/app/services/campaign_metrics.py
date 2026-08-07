"""What a campaign actually earned, and what nobody can currently see.

THE ONE HONEST JOIN. Shopify records the full landing URL of the session that
led to an order, query string included. So an order that arrived through a link
tagged `utm_campaign=summer-launch` is attributable to that campaign with no ad
platform, no pixel, and no modelling -- it is a string match against real money.
That is the foundation this whole feature stands on, and it is why every link a
campaign produces is tagged before it leaves the building.

WHAT THAT JOIN CANNOT DO, and what this module therefore refuses to compute:

    spend, impressions, reach, clicks, CTR, CPC   live inside Meta/Google/TikTok
    ROAS, CAC                                     need spend
    conversion rate, sessions                     need a web analytics source
    new vs returning                              needs customer records

A dashboard that renders those as `0` or `--` while the rest of the row is real
teaches the merchant to read every number as approximate. So they are returned
in `unavailable`, each naming the connector that would fill it, with NO value
attached -- the same contract `store_agent_context` uses, for the same reason.

REVENUE VS BUDGET IS NOT ROAS. Budget is what was planned; spend is what was
taken. Dividing revenue by budget produces a number that looks exactly like
ROAS and is not, so it is named `revenue_vs_budget` and never abbreviated.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.store_order import StoreOrder
from app.services.store_analytics import utm_params

# Metric -> what a merchant must connect for it to become real. User-facing
# wording: these strings are shown on the dashboard and quoted by the analyst.
UNAVAILABLE_SOURCE = {
    "spend": "Meta Ads or Google Ads",
    "impressions": "Meta Ads or Google Ads",
    "reach": "Meta Ads",
    "clicks": "Meta Ads or Google Ads",
    "ctr": "Meta Ads or Google Ads",
    "cpc": "Meta Ads or Google Ads",
    "roas": "Meta Ads or Google Ads (needs spend)",
    "cac": "Meta Ads or Google Ads (needs spend)",
    "conversion_rate": "Shopify Analytics API or Google Analytics",
    "sessions": "Shopify Analytics API or Google Analytics",
    "new_customers": "Shopify customer records",
    "returning_rate": "Shopify customer records",
    "profit": "per-product cost of goods, set in Shopify",
}

# Below this many attributed orders, a percentage change is noise dressed as a
# finding. Same threshold the store dashboard uses, for the same reason.
MIN_ORDERS_FOR_CHANGE = 5


def _num(value) -> float:
    return float(value or 0)


def campaign_of(landing_site: str | None) -> str | None:
    """The utm_campaign tag on an order's landing URL, if any."""
    return utm_params(landing_site).get("utm_campaign") or None


def _window(c: Campaign, today: date) -> tuple[date, date]:
    """The days an order may count toward this campaign.

    Starts at the launch date and runs to the end date, or today for a campaign
    still running. A campaign that never launched has no window and earns
    nothing -- which is correct: its tag has never been on a live link.
    """
    start = c.starts_on or (c.launched_at.date() if c.launched_at else None)
    if start is None:
        return today, today - timedelta(days=1)   # empty range
    end = c.ends_on or today
    return start, min(end, today)


async def attributed_orders(campaign: Campaign, db: AsyncSession) -> list[StoreOrder]:
    """Orders whose landing URL carries this campaign's tag, inside its window.

    The tag match happens in Python rather than SQL: the UTM lives in a query
    string inside a 2000-char column, and a LIKE against it would also match a
    campaign whose slug is a prefix of another's ("summer" matching
    "summer-launch"). Parsing is exact.
    """
    if not campaign.slug:
        return []
    today = datetime.now(timezone.utc).date()
    start, end = _window(campaign, today)
    if start > end:
        return []

    rows = (await db.execute(
        select(StoreOrder).where(
            StoreOrder.project_id == campaign.project_id,
            StoreOrder.org_id == campaign.org_id,
            StoreOrder.ordered_at >= datetime.combine(start, datetime.min.time(), timezone.utc),
            StoreOrder.ordered_at < datetime.combine(end + timedelta(days=1), datetime.min.time(), timezone.utc),
        )
    )).scalars().all()
    return [o for o in rows if campaign_of(o.landing_site) == campaign.slug]


def _totals(orders: list[StoreOrder]) -> dict:
    revenue = sum(_num(o.total_price) for o in orders)
    count = len(orders)
    return {"revenue": round(revenue, 2), "orders": count,
            "aov": round(revenue / count, 2) if count else 0.0}


def _daily(orders: list[StoreOrder], start: date, end: date) -> list[dict]:
    buckets: dict[str, dict] = {}
    d = start
    while d <= end:
        buckets[d.isoformat()] = {"date": d.isoformat(), "revenue": 0.0, "orders": 0}
        d += timedelta(days=1)
    for o in orders:
        if o.ordered_at is None:
            continue
        key = o.ordered_at.date().isoformat()
        if key in buckets:
            buckets[key]["revenue"] += _num(o.total_price)
            buckets[key]["orders"] += 1
    return [{**v, "revenue": round(v["revenue"], 2)} for v in buckets.values()]


def _by_utm(orders: list[StoreOrder], field: str) -> list[dict]:
    """Revenue split by a UTM dimension of the campaign's own links.

    This is the campaign's channel breakdown and it is genuinely measured: the
    campaign wrote `utm_source=instagram` onto its own link, and the order came
    back carrying it. Orders with the campaign tag but no source tag are named
    "untagged link" rather than dropped -- silently discarding them would make
    the split sum to less than the total.
    """
    agg: dict[str, dict] = {}
    for o in orders:
        key = utm_params(o.landing_site).get(field) or "untagged link"
        row = agg.setdefault(key, {"key": key, "revenue": 0.0, "orders": 0})
        row["revenue"] += _num(o.total_price)
        row["orders"] += 1
    out = [{**r, "revenue": round(r["revenue"], 2)} for r in agg.values()]
    return sorted(out, key=lambda r: r["revenue"], reverse=True)


def _target_progress(measured: dict, targets: dict | None, budget: float | None) -> list[dict]:
    """Progress toward the targets the merchant set, for targets we can measure.

    A target on ROAS or CAC is not silently skipped -- it comes back with
    `measurable: False` and the connector that would settle it, because a
    merchant who set a ROAS target deserves to know why it is not being scored.
    """
    out = []
    for key, target in (targets or {}).items():
        try:
            target_value = float(target)
        except (TypeError, ValueError):
            continue
        if target_value <= 0:
            continue
        if key in measured:
            current = measured[key]
            out.append({"key": key, "target": target_value, "current": current,
                        "pct": round(current / target_value * 100, 1), "measurable": True})
        else:
            out.append({"key": key, "target": target_value, "measurable": False,
                        "needs": UNAVAILABLE_SOURCE.get(key, "an unconnected data source")})
    return out


async def for_campaign(campaign: Campaign, db: AsyncSession) -> dict:
    """The campaign's performance: what is measured, and what is missing.

    Callers must treat `unavailable` as authoritative. Nothing in `measured`
    depends on an unconnected source, and nothing outside it should be rendered
    as a figure.
    """
    orders = await attributed_orders(campaign, db)
    today = datetime.now(timezone.utc).date()
    start, end = _window(campaign, today)

    totals = _totals(orders)
    currency = next((o.currency for o in orders if o.currency), None)

    # Today and yesterday, so a running campaign shows movement rather than one
    # cumulative number that barely changes.
    def _on(day: date) -> dict:
        return _totals([o for o in orders if o.ordered_at and o.ordered_at.date() == day])

    budget = float(campaign.budget_amount) if campaign.budget_amount is not None else None
    measured = {
        "revenue": totals["revenue"],
        "orders": totals["orders"],
        "aov": totals["aov"],
    }

    return {
        "campaign_id": str(campaign.id),
        "slug": campaign.slug,
        "currency": currency or campaign.budget_currency or "EUR",
        "window": {"start": start.isoformat(), "end": end.isoformat(),
                   "days": max((end - start).days + 1, 0)},
        "attribution": {
            "method": "utm_campaign on the order's landing URL",
            "matched_orders": totals["orders"],
        },
        "lifetime": totals,
        "today": _on(today),
        "yesterday": _on(today - timedelta(days=1)),
        "series": _daily(orders, start, end) if start <= end else [],
        "by_source": _by_utm(orders, "utm_source"),
        "by_medium": _by_utm(orders, "utm_medium"),
        "by_content": _by_utm(orders, "utm_content"),
        # Named for exactly what it is. See the module docstring.
        "revenue_vs_budget": (round(totals["revenue"] / budget, 2)
                              if budget and budget > 0 else None),
        "budget": budget,
        "targets": _target_progress(measured, campaign.targets, budget),
        # No values, on purpose.
        "unavailable": [{"metric": k, "needs": v} for k, v in UNAVAILABLE_SOURCE.items()],
    }


async def portfolio(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> dict:
    """Roll-up across every campaign in the project, for the command centre.

    Counts come from the campaigns table; money comes from attributed orders.
    They are computed separately on purpose: a campaign can exist in every
    status without having earned anything, and a count that implies revenue is
    the kind of vanity metric this dashboard is meant to avoid.
    """
    campaigns = (await db.execute(select(Campaign).where(
        Campaign.project_id == project_id, Campaign.org_id == org_id
    ))).scalars().all()

    by_status: dict[str, int] = {}
    for c in campaigns:
        by_status[c.status] = by_status.get(c.status, 0) + 1

    revenue = 0.0
    order_count = 0
    tagged = 0
    for c in campaigns:
        if c.status in ("draft", "planning", "archived"):
            continue
        orders = await attributed_orders(c, db)
        if orders:
            tagged += 1
        revenue += sum(_num(o.total_price) for o in orders)
        order_count += len(orders)

    total_budget = sum(float(c.budget_amount) for c in campaigns
                       if c.budget_amount is not None and c.status not in ("draft", "archived"))

    return {
        "total": len(campaigns),
        "by_status": by_status,
        "revenue": round(revenue, 2),
        "orders": order_count,
        "aov": round(revenue / order_count, 2) if order_count else 0.0,
        "budget": round(total_budget, 2) if total_budget else None,
        "revenue_vs_budget": round(revenue / total_budget, 2) if total_budget > 0 else None,
        "campaigns_with_attributed_orders": tagged,
        "unavailable": [{"metric": k, "needs": v} for k, v in UNAVAILABLE_SOURCE.items()],
    }
