"""Mock figures for the store KPIs that have no data source yet.

EVERY NUMBER HERE IS INVENTED. It exists so the dashboard can be designed and
reviewed against realistic shapes before the Shopify integration reaches them.

Three of the four sections below need data the orders sync does not collect:

  * products  -> order LINE ITEMS, not stored yet
  * customers -> customer records, deliberately not stored (personal data; see
                 store_revenue_service, which requests only attribution fields)
  * traffic   -> Shopify's Analytics API, a separate integration from Orders

Replacing this file is the whole job when those land: the endpoint, the types
and the UI all take these shapes already, so nothing above this layer changes.

`is_mock` is returned with the payload so the UI can label it. A dashboard that
shows invented numbers without saying so is the one failure this file must not
cause.
"""
from __future__ import annotations

import hashlib


def _jitter(seed: str, lo: float, hi: float) -> float:
    """Stable pseudo-random in a range, so a project's numbers do not change on
    every refresh -- a dashboard that reshuffles itself looks broken."""
    h = int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16)
    return lo + (h % 1000) / 1000 * (hi - lo)


def mock_products(project_id: str, currency: str = "USD") -> list[dict]:
    names = [
        "Trail Runner GTX", "Merino Base Layer", "Alpine Shell Jacket",
        "Cushioned Sock 3-pack", "Hydration Vest 12L", "Trekking Pole Pair",
    ]
    out = []
    for i, name in enumerate(names):
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
