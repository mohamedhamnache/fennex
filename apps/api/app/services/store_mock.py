"""Mock figures for the store KPIs that have no data source yet.

EVERY NUMBER HERE IS INVENTED. It exists so the dashboard can be designed and
reviewed against realistic shapes before the Shopify integration reaches them.

WHY ONE FILE. Every invented number in the product lives here and nowhere else.
That is what makes "which of these figures is real?" answerable by reading one
import list rather than auditing a dashboard. Each section below names the
exact data source that will replace it:

  * products / collections / variants / vendors -> order LINE ITEMS
  * customers, cohorts, LTV                     -> customer records (see
      store_revenue_service: we deliberately store no personal data today)
  * sessions, funnel, device                    -> Shopify Analytics API
  * country / city                              -> order shipping address
  * profit, margin, COGS                        -> product cost fields
  * refunds, net sales                          -> Refund objects
  * inventory, fulfillment                      -> InventoryLevel / Fulfillment
  * ROAS, CAC, MER, ad spend                    -> ad platform connectors
      (Meta, Google Ads) -- not Shopify at all

Replacing this file is the whole job when those land: the endpoint, the types
and the UI all take these shapes already, so nothing above this layer changes.

Every section is returned under a `source` of "sample" so the UI can label it.
A dashboard that shows invented numbers without saying so is the one failure
this file must not cause.
"""
from __future__ import annotations

import hashlib
from datetime import date, timedelta


def _jitter(seed: str, lo: float, hi: float) -> float:
    """Stable pseudo-random in a range, so a project's numbers do not change on
    every refresh -- a dashboard that reshuffles itself looks broken."""
    h = int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16)
    return lo + (h % 1000) / 1000 * (hi - lo)


PRODUCTS = [
    "Trail Runner GTX", "Merino Base Layer", "Alpine Shell Jacket",
    "Cushioned Sock 3-pack", "Hydration Vest 12L", "Trekking Pole Pair",
    "Down Puffer 800", "Summit Beanie", "Approach Shoe Low", "Rain Shell Pant",
]
COLLECTIONS = ["Footwear", "Outerwear", "Base layers", "Accessories", "Packs"]
VENDORS = ["Northline", "Cairn & Co", "Vertex Gear", "Meridian"]
VARIANTS = ["Black / M", "Black / L", "Slate / M", "Olive / L", "Sand / S"]
COUNTRIES = [
    ("United States", "US"), ("France", "FR"), ("United Kingdom", "GB"),
    ("Germany", "DE"), ("Canada", "CA"), ("Australia", "AU"),
    ("Netherlands", "NL"), ("Spain", "ES"),
]
CITIES = ["New York", "Paris", "London", "Berlin", "Toronto", "Sydney", "Lyon", "Madrid"]
DEVICES = ["Mobile", "Desktop", "Tablet"]


def mock_products(project_id: str, currency: str = "USD") -> list[dict]:
    """Top products. Needs order line items."""
    out = []
    for i, name in enumerate(PRODUCTS[:6]):
        units = int(_jitter(f"{project_id}u{i}", 8, 140))
        price = round(_jitter(f"{project_id}p{i}", 18, 320), 2)
        out.append({
            "product": name,
            "units": units,
            "revenue": round(units * price, 2),
            "currency": currency,
        })
    return sorted(out, key=lambda r: r["revenue"], reverse=True)


def mock_customers(project_id: str) -> dict:
    """New vs returning only. Deliberately no names, emails or addresses: the
    split is the insight, and holding people to get it is a liability the
    feature does not need."""
    new = int(_jitter(f"{project_id}new", 40, 220))
    returning = int(_jitter(f"{project_id}ret", 15, 120))
    total = new + returning
    return {
        "new": new,
        "returning": returning,
        "repeat_rate": round(returning / total * 100, 1) if total else 0.0,
    }


def mock_traffic(project_id: str, orders: int) -> dict:
    """Sessions and conversion. Needs Shopify's Analytics API, which is a
    separate connector from Orders."""
    sessions = int(_jitter(f"{project_id}s", 1800, 12000))
    return {
        "sessions": sessions,
        "conversion_rate": round(orders / sessions * 100, 2) if sessions else 0.0,
        "sessions_from_content": int(sessions * _jitter(f"{project_id}c", 0.12, 0.42)),
    }


# ── the wider dashboard ──────────────────────────────────────────────────────

def mock_funnel(project_id: str, orders: int, sessions: int) -> list[dict]:
    """Sessions -> product views -> add to cart -> checkout -> purchased.

    Purchases are pinned to the REAL order count so the bottom of the funnel
    agrees with the revenue above it. A funnel that ends on a different number
    than the orders KPI reads as a bug even when both are labelled.
    """
    views = int(sessions * _jitter(f"{project_id}f1", 0.55, 0.78))
    carts = int(views * _jitter(f"{project_id}f2", 0.18, 0.34))
    checkout = int(carts * _jitter(f"{project_id}f3", 0.42, 0.66))
    purchased = orders if orders else int(checkout * 0.55)
    stages = [
        ("Sessions", sessions), ("Product views", views), ("Add to cart", carts),
        ("Reached checkout", checkout), ("Purchased", purchased),
    ]
    out, first = [], sessions or 1
    for i, (name, n) in enumerate(stages):
        prev = stages[i - 1][1] if i else n
        out.append({
            "stage": name,
            "users": n,
            "conv": round(n / first * 100, 2),
            # Step-to-step drop, not drop from the top: the top-level number is
            # already the `conv` column, and repeating it teaches nothing.
            "dropoff": round((prev - n) / prev * 100, 1) if prev else 0.0,
            "lost": max(0, prev - n),
        })
    return out


def _weighted(project_id: str, labels: list, total: float, salt: str) -> list[dict]:
    """Split a total across labels with a stable, believably uneven shape."""
    weights = [_jitter(f"{project_id}{salt}{i}", 0.4, 3.0) for i in range(len(labels))]
    s = sum(weights) or 1
    rows = []
    for label, w in zip(labels, weights):
        rows.append({"label": label, "revenue": round(total * w / s, 2),
                     "share": round(w / s * 100, 1)})
    return sorted(rows, key=lambda r: r["revenue"], reverse=True)


def mock_breakdown(project_id: str, dimension: str, total: float, orders: int) -> list[dict]:
    """Revenue split across a dimension the orders sync cannot see."""
    labels = {
        "product": PRODUCTS[:8], "collection": COLLECTIONS, "vendor": VENDORS,
        "variant": VARIANTS, "country": [c[0] for c in COUNTRIES],
        "city": CITIES, "device": DEVICES,
    }.get(dimension, PRODUCTS[:6])
    rows = _weighted(project_id, labels, total, dimension)
    for r in rows:
        r["orders"] = max(1, round(orders * r["share"] / 100)) if orders else 0
    return rows


def mock_product_performance(project_id: str, currency: str) -> dict:
    """Per-product economics. Needs line items, cost fields and inventory."""
    rows = []
    for i, name in enumerate(PRODUCTS):
        units = int(_jitter(f"{project_id}pp{i}", 4, 180))
        price = round(_jitter(f"{project_id}ppp{i}", 18, 320), 2)
        revenue = round(units * price, 2)
        margin = _jitter(f"{project_id}ppm{i}", 0.28, 0.68)
        rows.append({
            "product": name,
            "units": units,
            "revenue": revenue,
            "profit": round(revenue * margin, 2),
            "margin": round(margin * 100, 1),
            "inventory": int(_jitter(f"{project_id}ppi{i}", 0, 240)),
            "conversion": round(_jitter(f"{project_id}ppc{i}", 0.4, 6.5), 2),
            "refund_rate": round(_jitter(f"{project_id}ppr{i}", 0.0, 9.0), 1),
            "trend": round(_jitter(f"{project_id}ppt{i}", -45, 85), 1),
            "currency": currency,
        })
    by_rev = sorted(rows, key=lambda r: r["revenue"], reverse=True)
    return {
        "top": by_rev[:8],
        "trending": sorted(rows, key=lambda r: r["trend"], reverse=True)[:5],
        # Worst is ranked by trend, not by revenue: the smallest seller is often
        # a niche line nobody expected to be big, while a former best-seller in
        # free-fall is the one that needs attention today.
        "worst": sorted(rows, key=lambda r: r["trend"])[:5],
    }


def mock_customer_analytics(project_id: str, currency: str) -> dict:
    base = mock_customers(project_id)
    aov = _jitter(f"{project_id}cav", 45, 180)
    orders_per_customer = _jitter(f"{project_id}opc", 1.2, 3.4)
    top = []
    for i in range(6):
        n_orders = int(_jitter(f"{project_id}tc{i}", 2, 14))
        top.append({
            # Initials only. A "top customers" table is exactly where a merchant
            # dashboard starts quietly accumulating other people's personal data.
            "label": f"Customer {chr(65 + i)}.{chr(75 + i)}.",
            "orders": n_orders,
            "revenue": round(n_orders * aov * _jitter(f"{project_id}tcv{i}", 0.8, 2.2), 2),
            "currency": currency,
        })
    # Cohort retention: rows are months, columns are months since first order.
    cohorts = []
    first_of_month = date.today().replace(day=1)
    for m in range(6):
        month = (first_of_month - timedelta(days=31 * (5 - m))).strftime("%Y-%m")
        size = int(_jitter(f"{project_id}co{m}", 60, 400))
        cells = []
        for p in range(6 - m):
            # Retention decays: steeply after month 1, then flattens.
            rate = 100.0 if p == 0 else _jitter(f"{project_id}cr{m}{p}", 8, 46) / (1 + p * 0.35)
            cells.append(round(rate, 1))
        cohorts.append({"cohort": month, "size": size, "cells": cells})
    return {
        **base,
        "ltv": round(aov * orders_per_customer * _jitter(f"{project_id}ltv", 1.1, 2.6), 2),
        "revenue_per_customer": round(aov * orders_per_customer, 2),
        "avg_days_between": round(_jitter(f"{project_id}dbo", 18, 96), 1),
        "top": sorted(top, key=lambda r: r["revenue"], reverse=True),
        "cohorts": cohorts,
        "growth": [
            {"date": (date.today() - timedelta(days=(11 - i) * 7)).isoformat(),
             "new": int(_jitter(f"{project_id}gn{i}", 8, 70)),
             "returning": int(_jitter(f"{project_id}gr{i}", 4, 48))}
            for i in range(12)
        ],
    }


def mock_marketing(project_id: str, revenue: float) -> dict:
    """Ad economics. NOT a Shopify integration -- ROAS, CAC and MER need spend
    from the ad platforms themselves (Meta, Google Ads)."""
    spend = (revenue * _jitter(f"{project_id}sp", 0.12, 0.42)) or 1.0
    ad_revenue = revenue * _jitter(f"{project_id}ar", 0.25, 0.62)
    new_customers = max(1, int(_jitter(f"{project_id}nc", 30, 190)))
    campaigns = []
    for i, name in enumerate(["Spring Prospecting", "Retargeting - 30d", "Brand Search",
                              "Newsletter - Weekly", "Creators - Q3"]):
        c_spend = spend * _jitter(f"{project_id}cs{i}", 0.06, 0.4)
        campaigns.append({
            "label": name,
            "spend": round(c_spend, 2),
            "revenue": round(c_spend * _jitter(f"{project_id}cro{i}", 0.7, 6.2), 2),
            "orders": int(_jitter(f"{project_id}cor{i}", 3, 120)),
            "roas": round(_jitter(f"{project_id}cro{i}", 0.7, 6.2), 2),
        })
    return {
        "spend": round(spend, 2),
        "ad_revenue": round(ad_revenue, 2),
        "roas": round(ad_revenue / spend, 2) if spend else 0.0,
        # MER is TOTAL revenue over spend -- the blended number a store is
        # actually run on, and the reason it differs from ROAS is the point.
        "mer": round(revenue / spend, 2) if spend else 0.0,
        "cac": round(spend / new_customers, 2),
        "campaigns": sorted(campaigns, key=lambda c: c["roas"], reverse=True),
    }


def mock_live(project_id: str) -> dict:
    return {
        "visitors": int(_jitter(f"{project_id}lv", 3, 180)),
        "checkouts": int(_jitter(f"{project_id}lc", 0, 9)),
        "carts": int(_jitter(f"{project_id}lk", 2, 40)),
    }


def mock_operations(project_id: str, currency: str) -> dict:
    low = []
    for i in range(4):
        low.append({
            "product": PRODUCTS[i],
            "stock": int(_jitter(f"{project_id}ls{i}", 0, 11)),
            "days_left": round(_jitter(f"{project_id}ld{i}", 1, 21), 1),
        })
    return {
        "low_stock": sorted(low, key=lambda r: r["stock"]),
        "out_of_stock": PRODUCTS[4:6],
        "returns": int(_jitter(f"{project_id}rt", 0, 24)),
        "refunds": round(_jitter(f"{project_id}rf", 0, 1400), 2),
        "refund_rate": round(_jitter(f"{project_id}rfr", 0.2, 6.5), 1),
        "pending": int(_jitter(f"{project_id}pd", 0, 38)),
        "unfulfilled": int(_jitter(f"{project_id}uf", 0, 22)),
        "avg_fulfillment_hours": round(_jitter(f"{project_id}af", 6, 72), 1),
        "currency": currency,
    }


def mock_geo(project_id: str, revenue: float, orders: int) -> list[dict]:
    rows = _weighted(project_id, [c[0] for c in COUNTRIES], revenue, "geo")
    codes = dict(COUNTRIES)
    for r in rows:
        r["code"] = codes.get(r["label"], "")
        r["orders"] = max(1, round(orders * r["share"] / 100)) if orders else 0
        r["conversion"] = round(_jitter(f"{project_id}gc{r['label']}", 0.6, 5.4), 2)
    return rows


def mock_margin(project_id: str) -> float:
    """Gross margin as a fraction. Needs per-product cost of goods."""
    return _jitter(f"{project_id}gm", 0.34, 0.64)


def mock_refund_rate(project_id: str) -> float:
    """Refunds as a fraction of gross. Needs Refund objects from the Orders API."""
    return _jitter(f"{project_id}rr", 0.005, 0.06)
