"""The store analytics dashboard: one payload, every figure labelled by origin.

WHAT IS REAL AND WHAT IS NOT. The orders sync stores six useful fields per
order -- total, currency, timestamp, landing page, referrer and source. A
surprising amount falls out of those honestly:

  live      revenue, orders, AOV, daily series, previous-period comparison,
            channel mix, referrer mix, landing pages, UTM campaigns, today's
            numbers, the newest-orders feed, and the forecast (which is
            derived from the real series, not invented)
  sample    everything requiring data we do not hold: sessions and the funnel,
            line items (products, collections, variants, vendors), customers
            and cohorts, geography, cost of goods, refunds, inventory,
            fulfillment, and ad spend

Every block carries `source`, and `sources` maps section -> origin so the UI
never has to guess. That labelling is the feature's integrity: a dashboard
mixing measured and invented numbers without saying which is which is worse
than one that shows less.

NOTHING HERE CALLS AN LLM. The "AI insights" are rules over the numbers above.
That is deliberate on two counts: a model asked to describe a table invents
causes it cannot know, and every generated insight would be metered spend on
a panel that refreshes on every date-range change.
"""
from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.store_order import StoreOrder
from app.services import store_mock

# Anything below this many orders makes period-over-period percentages
# meaningless -- one extra sale swings a three-order week by 33%.
MIN_ORDERS_FOR_CHANGE = 5

# Referrer host -> channel. Only hosts we can attribute with certainty; anything
# else keeps its own domain as a Referral row rather than being bucketed wrongly.
_SOCIAL = {"facebook.com", "instagram.com", "t.co", "twitter.com", "x.com", "pinterest.com",
           "tiktok.com", "linkedin.com", "reddit.com", "youtube.com"}
_SEARCH = {"google.com", "bing.com", "duckduckgo.com", "yahoo.com", "ecosia.org", "qwant.com"}


def _host(url: str | None) -> str | None:
    if not url:
        return None
    try:
        h = (urlparse(url if "//" in url else f"//{url}").hostname or "").lower()
    except ValueError:
        return None
    return h[4:] if h.startswith("www.") else h or None


def classify_referrer(referring_site: str | None, landing_site: str | None) -> str:
    """The channel an order arrived through, from the referrer we were given.

    Paid vs organic search cannot be told apart from the referrer alone, so a
    Google referral is only called Paid search when the landing URL carries a
    paid marker (gclid, or utm_medium=cpc). Guessing otherwise would credit ads
    for organic traffic -- the single most expensive attribution error a store
    can make, because it is the number budgets are set from.
    """
    utm = utm_params(landing_site)
    medium = (utm.get("utm_medium") or "").lower()
    if medium in {"cpc", "ppc", "paid", "paidsearch", "paid_search"} or utm.get("gclid"):
        return "Paid search"
    if utm.get("utm_source") and medium == "email":
        return "Email"
    host = _host(referring_site)
    if not host:
        # NOT "Direct". This bucket is every order that arrived without a
        # referrer, and that covers two opposite cases: someone who typed the
        # URL, and someone whose referrer was simply never recorded. Labelling
        # it "Direct" asserted the first, and a live agent read a store where
        # no order carried a referrer as 99% direct traffic and advised buying
        # ads to diversify. The label has to carry the ambiguity, because a
        # share threshold cannot -- one genuine referral drops the rest below
        # any cutoff while the ambiguity is unchanged.
        return "Direct or unattributed"
    if host in _SEARCH:
        return "Organic search"
    if host in _SOCIAL:
        return "Social"
    return "Referral"


def utm_params(landing_site: str | None) -> dict[str, str]:
    """UTM tags off the landing URL.

    These are real: Shopify records the full landing URL including its query
    string, and campaign tags survive there even though attribution matching
    strips them. It is the one marketing dimension available without connecting
    an ad platform.
    """
    if not landing_site or "?" not in landing_site:
        return {}
    try:
        q = parse_qs(urlparse(landing_site if "//" in landing_site else f"//{landing_site}").query)
    except ValueError:
        return {}
    return {k.lower(): v[0] for k, v in q.items() if v}


def _change(current: float, previous: float, orders: int) -> float | None:
    """Percentage change, or None when the comparison would be noise.

    None is a real answer here. A 900% swing off two orders is not information,
    and rendering it beside a green arrow tells the merchant something false.
    """
    if previous <= 0 or orders < MIN_ORDERS_FOR_CHANGE:
        return None
    return round((current - previous) / previous * 100, 1)


def forecast_series(series: list[dict], horizon: int = 14) -> list[dict]:
    """Project revenue forward from the real daily series.

    Least-squares trend plus a day-of-week factor. This is a projection of what
    has been happening, not a prediction -- it cannot know about a launch, a
    holiday or a stock-out, so the UI must present it as a continuation of the
    current trend and nothing more.
    """
    pts = [(i, d["revenue"]) for i, d in enumerate(series) if d["revenue"] is not None]
    if len(pts) < 7:
        return []
    n = len(pts)
    mean_x = sum(p[0] for p in pts) / n
    mean_y = sum(p[1] for p in pts) / n
    denom = sum((p[0] - mean_x) ** 2 for p in pts) or 1
    slope = sum((p[0] - mean_x) * (p[1] - mean_y) for p in pts) / denom
    intercept = mean_y - slope * mean_x

    # Day-of-week factors, so a Saturday is not projected as an average day.
    by_dow: dict[int, list[float]] = defaultdict(list)
    for d in series:
        try:
            dow = date.fromisoformat(d["date"]).weekday()
        except ValueError:
            continue
        by_dow[dow].append(d["revenue"])
    overall = mean_y or 1
    factors = {dow: (sum(v) / len(v)) / overall for dow, v in by_dow.items() if v}

    last = date.fromisoformat(series[-1]["date"])
    out = []
    for k in range(1, horizon + 1):
        day = last + timedelta(days=k)
        base = max(0.0, intercept + slope * (n - 1 + k))
        out.append({
            "date": day.isoformat(),
            "revenue": round(base * factors.get(day.weekday(), 1.0), 2),
        })
    return out


async def _rows(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession,
                start: datetime, end: datetime) -> list[StoreOrder]:
    """Orders in a window, always scoped to the organisation.

    org_id is required for the same reason it is on the revenue summary:
    project_id arrives from the query string and is guessable.
    """
    return list((await db.execute(
        select(StoreOrder).where(
            StoreOrder.org_id == org_id,
            StoreOrder.project_id == project_id,
            StoreOrder.ordered_at >= start,
            StoreOrder.ordered_at < end,
        ).order_by(StoreOrder.ordered_at.desc())
    )).scalars().all())


def _totals(rows: list[StoreOrder]) -> tuple[float, int, float]:
    revenue = float(sum(float(r.total_price or 0) for r in rows))
    orders = len(rows)
    return revenue, orders, (revenue / orders if orders else 0.0)


def _daily(rows: list[StoreOrder], start: date, days: int) -> list[dict]:
    """One entry per day INCLUDING days with no orders.

    Gap days matter: a chart that silently skips them compresses a quiet week
    into a flat line and hides exactly the drop worth seeing.
    """
    buckets: dict[str, dict] = {}
    for k in range(days):
        d = (start + timedelta(days=k)).isoformat()
        buckets[d] = {"date": d, "revenue": 0.0, "orders": 0, "attributed": 0.0}
    for r in rows:
        if not r.ordered_at:
            continue
        key = r.ordered_at.date().isoformat()
        b = buckets.get(key)
        if not b:
            continue
        amount = float(r.total_price or 0)
        b["revenue"] += amount
        b["orders"] += 1
        if r.attributed_article_id:
            b["attributed"] += amount
    out = []
    for b in buckets.values():
        b["revenue"] = round(b["revenue"], 2)
        b["attributed"] = round(b["attributed"], 2)
        b["aov"] = round(b["revenue"] / b["orders"], 2) if b["orders"] else 0.0
        out.append(b)
    return out


def _moving_average(series: list[dict], window: int = 7) -> list[dict]:
    """Adds `ma` to each point. A 7-day mean is what makes a weekly cycle stop
    looking like volatility."""
    vals = [d["revenue"] for d in series]
    for i, d in enumerate(series):
        lo = max(0, i - window + 1)
        chunk = vals[lo:i + 1]
        d["ma"] = round(sum(chunk) / len(chunk), 2) if chunk else 0.0
    return series


def _group(rows: list[StoreOrder], key) -> list[dict]:
    agg: dict[str, dict] = defaultdict(lambda: {"revenue": 0.0, "orders": 0})
    for r in rows:
        label = key(r)
        if not label:
            continue
        agg[label]["revenue"] += float(r.total_price or 0)
        agg[label]["orders"] += 1
    total = sum(v["revenue"] for v in agg.values()) or 1
    out = [{"label": k, "revenue": round(v["revenue"], 2), "orders": v["orders"],
            "share": round(v["revenue"] / total * 100, 1)} for k, v in agg.items()]
    return sorted(out, key=lambda r: r["revenue"], reverse=True)


def _kpi(key: str, value: float, prev: float, unit: str, source: str,
         orders: int, spark: list[float] | None = None) -> dict:
    return {
        "key": key, "value": round(value, 2), "prev": round(prev, 2), "unit": unit,
        "change": _change(value, prev, orders), "source": source, "spark": spark or [],
    }


def build_insights(kpis: dict, series: list[dict], channels: list[dict],
                   articles: list[dict], ops: dict, currency: str) -> list[dict]:
    """Ranked observations, computed from the numbers -- no model involved.

    Each insight states only what its own data supports and carries the origin
    of the figures it cites, so a sample-derived claim can never read as a
    measured one. `impact` orders the list; the merchant should not have to
    read all of them to find the one that matters.
    """
    out: list[dict] = []

    rev, prev_rev = kpis["revenue"]["value"], kpis["revenue"]["prev"]
    change = kpis["revenue"]["change"]
    if change is not None and abs(change) >= 5:
        direction = "up" if change > 0 else "down"
        out.append({
            "kind": "revenue", "severity": "good" if change > 0 else "bad",
            "impact": min(100, int(abs(change)) + 40), "source": "live",
            "text": f"Revenue is {direction} {abs(change):.0f}% on the previous period "
                    f"({rev:,.0f} vs {prev_rev:,.0f} {currency}).",
        })

    aov_change = kpis["aov"]["change"]
    ord_change = kpis["orders"]["change"]
    if aov_change is not None and ord_change is not None and change is not None:
        # Which of the two moved revenue. A merchant reacts differently to
        # "fewer people bought" than to "people spent less", and the raw
        # revenue number alone cannot tell them apart.
        if abs(aov_change) > abs(ord_change) * 1.5:
            out.append({
                "kind": "mix", "severity": "info", "impact": 62, "source": "live",
                "text": f"Basket size drove the change, not traffic: average order "
                        f"moved {aov_change:+.0f}% while order count moved {ord_change:+.0f}%.",
            })
        elif abs(ord_change) > abs(aov_change) * 1.5:
            out.append({
                "kind": "mix", "severity": "info", "impact": 62, "source": "live",
                "text": f"Order volume drove the change, not basket size: orders moved "
                        f"{ord_change:+.0f}% while average order moved {aov_change:+.0f}%.",
            })

    if channels:
        lead = channels[0]
        if lead["share"] >= 35:
            out.append({
                "kind": "channel", "severity": "info", "impact": int(lead["share"]),
                "source": "live",
                "text": f"{lead['label']} brought {lead['share']:.0f}% of revenue "
                        f"({lead['orders']} orders). Concentration is a risk as well as a strength.",
            })

    if articles:
        top = articles[0]
        out.append({
            "kind": "content", "severity": "good", "impact": 58, "source": "live",
            "text": f"\"{top['title']}\" started {top['orders']} orders worth "
                    f"{top['revenue']:,.0f} {currency} -- your best earning page.",
        })

    # Streaks: consecutive days of growth are the shape a merchant notices last
    # in a chart and first in a sentence.
    streak = 0
    for i in range(len(series) - 1, 0, -1):
        if series[i]["revenue"] > series[i - 1]["revenue"]:
            streak += 1
        else:
            break
    if streak >= 3:
        out.append({"kind": "streak", "severity": "good", "impact": 40 + streak * 3,
                    "source": "live",
                    "text": f"Revenue has risen {streak} days in a row."})

    # Anomaly: a day more than 2.5x the period mean is worth naming.
    vals = [d["revenue"] for d in series if d["revenue"] > 0]
    if len(vals) >= 7:
        mean = sum(vals) / len(vals)
        peak = max(series, key=lambda d: d["revenue"])
        if mean > 0 and peak["revenue"] > mean * 2.5:
            out.append({
                "kind": "anomaly", "severity": "info", "impact": 55, "source": "live",
                "text": f"{peak['date']} was an outlier at {peak['revenue']:,.0f} {currency}, "
                        f"{peak['revenue'] / mean:.1f}x the period average.",
            })

    low = [p for p in ops["low_stock"] if p["days_left"] <= 7]
    if low:
        first = min(low, key=lambda p: p["days_left"])
        n = round(first["days_left"])
        when = "today" if n <= 0 else "in about a day" if n == 1 else f"in about {n} days"
        out.append({
            "kind": "inventory", "severity": "bad", "impact": 88, "source": "sample",
            "text": f"{first['product']} runs out {when} at the current rate "
                    f"({first['stock']} left).",
        })

    return sorted(out, key=lambda i: i["impact"], reverse=True)[:8]


def build_alerts(kpis: dict, ops: dict, marketing: dict) -> list[dict]:
    """Things that want a decision today. Deliberately few: an alert list long
    enough to scroll is one nobody reads."""
    out = []
    rev_change = kpis["revenue"]["change"]
    if rev_change is not None and rev_change <= -15:
        out.append({"kind": "revenue_drop", "severity": "bad", "source": "live",
                    "text": f"Revenue fell {abs(rev_change):.0f}% against the previous period."})
    if rev_change is not None and rev_change >= 40:
        out.append({"kind": "record", "severity": "good", "source": "live",
                    "text": f"Revenue is up {rev_change:.0f}% -- the strongest period in this window."})
    if ops["refund_rate"] >= 4:
        out.append({"kind": "refunds", "severity": "bad", "source": "sample",
                    "text": f"Refund rate is {ops['refund_rate']:.1f}%, above the 4% watch line."})
    if ops["out_of_stock"]:
        out.append({"kind": "stock_out", "severity": "bad", "source": "sample",
                    "text": f"{len(ops['out_of_stock'])} products are out of stock."})
    if marketing["roas"] < 1.5:
        out.append({"kind": "roas", "severity": "bad", "source": "sample",
                    "text": f"ROAS is {marketing['roas']:.2f}x -- ad spend is close to unprofitable."})
    if ops["unfulfilled"] >= 15:
        out.append({"kind": "fulfilment", "severity": "warn", "source": "sample",
                    "text": f"{ops['unfulfilled']} orders are still unfulfilled."})
    return out


async def dashboard(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession,
                    days: int = 30) -> dict:
    """The whole store dashboard for one project and one window."""
    days = max(1, min(days, 365))
    now = datetime.now(timezone.utc)
    end = now + timedelta(seconds=1)
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    prev_start = start - timedelta(days=days)

    rows = await _rows(project_id, org_id, db, start, end)
    prev_rows = await _rows(project_id, org_id, db, prev_start, start)

    revenue, orders, aov = _totals(rows)
    p_revenue, p_orders, p_aov = _totals(prev_rows)
    currency = next((r.currency for r in rows if r.currency), None) or "USD"
    pid = str(project_id)

    series = _moving_average(_daily(rows, start.date(), days))
    prev_series = _daily(prev_rows, prev_start.date(), days)
    # Aligned by index so the comparison overlays the current window.
    for i, d in enumerate(series):
        d["prev_revenue"] = prev_series[i]["revenue"] if i < len(prev_series) else None

    # ── sample-derived economics ─────────────────────────────────────────────
    margin = store_mock.mock_margin(pid)
    refund_rate = store_mock.mock_refund_rate(pid)
    net_sales = revenue * (1 - refund_rate)
    p_net_sales = p_revenue * (1 - refund_rate)
    gross_profit = net_sales * margin
    traffic = store_mock.mock_traffic(pid, orders)
    sessions = traffic["sessions"]
    conversion = (orders / sessions * 100) if sessions else 0.0
    customers = store_mock.mock_customer_analytics(pid, currency)
    marketing = store_mock.mock_marketing(pid, revenue)
    ops = store_mock.mock_operations(pid, currency)

    for d in series:
        d["net_sales"] = round(d["revenue"] * (1 - refund_rate), 2)
        d["profit"] = round(d["revenue"] * (1 - refund_rate) * margin, 2)

    spark = [d["revenue"] for d in series]
    spark_orders = [float(d["orders"]) for d in series]
    spark_aov = [d["aov"] for d in series]

    # A sample figure has no sample PREVIOUS period, so its previous value is 0
    # and `_change` returns None. Copying the current value into `prev` would
    # render "0.0% -- was the same", which states that a placeholder held steady
    # against a placeholder: a measured-looking claim about nothing.
    kpis = {
        "revenue": _kpi("revenue", revenue, p_revenue, "money", "live", orders, spark),
        "net_sales": _kpi("net_sales", net_sales, p_net_sales, "money", "sample", orders,
                          [d["net_sales"] for d in series]),
        "orders": _kpi("orders", orders, p_orders, "int", "live", orders, spark_orders),
        "aov": _kpi("aov", aov, p_aov, "money", "live", orders, spark_aov),
        "conversion": _kpi("conversion", conversion, 0, "pct", "sample", orders, []),
        "sessions": _kpi("sessions", sessions, 0, "int", "sample", orders, []),
        "returning_rate": _kpi("returning_rate", customers["repeat_rate"], 0,
                               "pct", "sample", orders, []),
        "new_customers": _kpi("new_customers", customers["new"], 0, "int", "sample", orders, []),
        "gross_profit": _kpi("gross_profit", gross_profit, p_net_sales * margin, "money",
                             "sample", orders, [d["profit"] for d in series]),
        "margin": _kpi("margin", margin * 100, 0, "pct", "sample", orders, []),
        "roas": _kpi("roas", marketing["roas"], 0, "x", "sample", orders, []),
        "mer": _kpi("mer", marketing["mer"], 0, "x", "sample", orders, []),
    }

    # ── real breakdowns ──────────────────────────────────────────────────────
    channels = _group(rows, lambda r: classify_referrer(r.referring_site, r.landing_site))
    referrers = _group(rows, lambda r: _host(r.referring_site) or "Direct")
    landing = _group(rows, lambda r: r.attributed_path or _path(r.landing_site))
    campaigns = _group(rows, lambda r: utm_params(r.landing_site).get("utm_campaign"))
    sources = _group(rows, lambda r: utm_params(r.landing_site).get("utm_source"))
    order_sources = _group(rows, lambda r: r.source_name)

    breakdowns = {
        "channel": {"source": "live", "rows": channels},
        "traffic_source": {"source": "live", "rows": referrers},
        "landing_page": {"source": "live", "rows": landing},
        "campaign": {"source": "live", "rows": campaigns},
        "utm_source": {"source": "live", "rows": sources},
        "order_source": {"source": "live", "rows": order_sources},
    }
    for dim in ("product", "collection", "variant", "vendor", "country", "city", "device"):
        breakdowns[dim] = {"source": "sample",
                           "rows": store_mock.mock_breakdown(pid, dim, revenue or 1000.0, orders)}

    # ── content attribution, the part only we can compute ────────────────────
    from app.models.article import Article
    art_rows = (await db.execute(
        select(Article.id, Article.title, StoreOrder.attributed_path,
               func.count(StoreOrder.id),
               func.coalesce(func.sum(StoreOrder.total_price), 0))
        .join(StoreOrder, StoreOrder.attributed_article_id == Article.id)
        .where(StoreOrder.org_id == org_id, StoreOrder.project_id == project_id,
               StoreOrder.ordered_at >= start)
        .group_by(Article.id, Article.title, StoreOrder.attributed_path)
        .order_by(func.coalesce(func.sum(StoreOrder.total_price), 0).desc())
        .limit(12)
    )).all()
    articles = [{"article_id": str(r[0]), "title": r[1], "path": r[2],
                 "orders": r[3], "revenue": float(r[4] or 0)} for r in art_rows]
    attributed_revenue = float(sum(a["revenue"] for a in articles))

    # ── today, live ──────────────────────────────────────────────────────────
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_rows = [r for r in rows if r.ordered_at and r.ordered_at >= today_start]
    t_revenue, t_orders, _ = _totals(today_rows)
    live = {
        **store_mock.mock_live(pid),
        "orders_today": t_orders,
        "revenue_today": round(t_revenue, 2),
        "feed": [{
            "id": r.external_id,
            "at": r.ordered_at.isoformat() if r.ordered_at else None,
            "total": float(r.total_price or 0),
            "channel": classify_referrer(r.referring_site, r.landing_site),
            "path": r.attributed_path,
            "attributed": bool(r.attributed_article_id),
        } for r in rows[:12]],
    }

    forecast = forecast_series(series)
    projected = round(sum(f["revenue"] for f in forecast), 2)

    insights = build_insights(kpis, series, channels, articles, ops, currency)
    alerts = build_alerts(kpis, ops, marketing)

    return {
        "currency": currency,
        "range": {"days": days, "start": start.date().isoformat(),
                  "end": now.date().isoformat(),
                  "compare_start": prev_start.date().isoformat()},
        "kpis": kpis,
        "series": series,
        "funnel": {"source": "sample",
                   "rows": store_mock.mock_funnel(pid, orders, sessions)},
        "breakdowns": breakdowns,
        "customers": {"source": "sample", **customers},
        "products": {"source": "sample", **store_mock.mock_product_performance(pid, currency)},
        "marketing": {"source": "sample", **marketing},
        "live": {"source": "mixed", **live},
        "operations": {"source": "sample", **ops},
        "geo": {"source": "sample", "rows": store_mock.mock_geo(pid, revenue or 1000.0, orders)},
        "forecast": {"source": "derived", "rows": forecast, "projected_revenue": projected,
                     "horizon_days": len(forecast)},
        "content": {"source": "live", "rows": articles,
                    "revenue": round(attributed_revenue, 2),
                    "share": round(attributed_revenue / revenue * 100, 1) if revenue else 0.0},
        "insights": insights,
        "alerts": alerts,
        # One map the UI reads to badge every section, so a new section cannot
        # be added without declaring where its numbers came from.
        "sources": {
            "revenue": "live", "orders": "live", "aov": "live", "series": "live",
            "channel": "live", "landing_page": "live", "campaign": "live",
            "content": "live", "forecast": "derived",
            "net_sales": "sample", "profit": "sample", "conversion": "sample",
            "sessions": "sample", "funnel": "sample", "products": "sample",
            "customers": "sample", "geo": "sample", "marketing": "sample",
            "operations": "sample",
        },
    }


def _path(url: str | None) -> str | None:
    from app.services.store_revenue_service import normalise_path
    return normalise_path(url)


def to_csv(data: dict) -> str:
    """The daily series as CSV.

    The series and not the whole payload: a merchant exporting a dashboard
    wants the numbers behind the chart in a spreadsheet, and flattening twelve
    heterogeneous sections into one sheet produces a file nobody can use.
    Every column here is real except the two marked, which are named as such
    in the header so the label survives the export.
    """
    lines = ["date,revenue,orders,aov,attributed_revenue,net_sales_sample,profit_sample"]
    for d in data["series"]:
        lines.append(",".join(str(x) for x in [
            d["date"], d["revenue"], d["orders"], d["aov"], d["attributed"],
            d.get("net_sales", ""), d.get("profit", ""),
        ]))
    return "\n".join(lines) + "\n"
