"""The store, compacted for a model to reason about.

THE PROBLEM THIS SOLVES. The dashboard payload mixes figures measured from
synced orders with placeholders for sources that are not connected. On screen a
badge keeps them apart. A model handed the raw payload has no badge -- it sees
`"roas": 2.47` and, being helpful, tells the merchant to cut ad spend on the
strength of a number nobody measured. That is the most damaging thing this
feature could do, because the advice is specific, confident, and actionable.

So the payload is split before the model ever sees it:

    measured    figures derived from real orders. Recommendations may rest on
                these.
    unavailable named, with the connector that would supply them, and NO value.

An unavailable metric is not passed with a caveat -- it is passed with no
number at all. A caveat is a sentence a model can drop; a missing key is not.
`unavailable` still lists the metric names so the agent can say "I cannot see
your conversion rate; connect the Analytics API" rather than inventing one or
silently ignoring the gap.
"""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.services import store_analytics

# What a merchant would have to connect to make each blank real. The agent
# quotes these, so they are user-facing names, not internal ones.
_SOURCE_OF = {
    "net_sales": "Shopify refunds (already available -- needs a sync change)",
    "gross_profit": "per-product cost of goods, set in Shopify",
    "margin": "per-product cost of goods, set in Shopify",
    "conversion": "Shopify Analytics API",
    "sessions": "Shopify Analytics API",
    "returning_rate": "Shopify customer records",
    "new_customers": "Shopify customer records",
    "roas": "Meta or Google Ads",
    "mer": "Meta or Google Ads",
}


def _fmt(value: float, unit: str, currency: str) -> str:
    if unit == "money":
        return f"{value:,.2f} {currency}"
    if unit == "pct":
        return f"{value:.2f}%"
    if unit == "x":
        return f"{value:.2f}x"
    return f"{value:,.0f}"


async def build(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession,
                days: int = 30) -> dict:
    """Everything the ecommerce agent is allowed to reason from."""
    d = await store_analytics.dashboard(project_id, org_id, db, days)
    currency = d["currency"]

    measured: dict[str, dict] = {}
    unavailable: list[dict] = []
    for key, k in d["kpis"].items():
        if k["source"] == "live":
            measured[key] = {
                "value": _fmt(k["value"], k["unit"], currency),
                "change_pct": k["change"],          # None means "not comparable"
                "previous": _fmt(k["prev"], k["unit"], currency) if k["change"] is not None else None,
            }
        else:
            unavailable.append({"metric": key, "needs": _SOURCE_OF.get(key, "a connector")})

    # Only live breakdowns. A "revenue by product" split the orders sync cannot
    # see would otherwise become a merchandising recommendation.
    breakdowns = {
        name: [{"label": r["label"], "revenue": round(r["revenue"], 2),
                "orders": r["orders"], "share_pct": r["share"]}
               for r in block["rows"][:8]]
        for name, block in d["breakdowns"].items()
        if block["source"] == "live" and block["rows"]
    }
    unavailable_dimensions = sorted(
        name for name, block in d["breakdowns"].items() if block["source"] != "live")

    return {
        "currency": currency,
        "window": {"days": d["range"]["days"], "from": d["range"]["start"],
                   "to": d["range"]["end"]},
        "measured": measured,
        # Named but valueless on purpose -- see the module docstring.
        "unavailable": unavailable,
        "unavailable_dimensions": unavailable_dimensions,
        "revenue_by": breakdowns,
        "daily_revenue": [{"date": p["date"], "revenue": p["revenue"], "orders": p["orders"]}
                          for p in d["series"]],
        "content_revenue": {
            "revenue": d["content"]["revenue"],
            "share_pct": d["content"]["share"],
            "pages": [{"title": r["title"], "path": r["path"], "orders": r["orders"],
                       "revenue": r["revenue"]} for r in d["content"]["rows"][:10]],
        },
        "projection_next_14d": d["forecast"]["projected_revenue"] if d["forecast"]["rows"] else None,
        # Only the observations computed from measured figures. The sample-based
        # ones are dropped rather than labelled, for the reason in the docstring.
        "observations": [i["text"] for i in d["insights"] if i["source"] == "live"],
    }
