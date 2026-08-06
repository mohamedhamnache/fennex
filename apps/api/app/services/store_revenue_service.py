"""Orders from a connected store, and the article each one can be traced to.

This is the join the rest of analytics was missing. Search Console answers "what
got found"; this answers "what got bought", and the two together are the only
honest way to say a piece of content was worth writing.

WHAT ATTRIBUTION HERE IS, AND IS NOT. Shopify records `landing_site`: the first
page of the session that ended in an order. If that page is one we published, we
say the order started there. That is a real, checkable signal -- it is not a
model's opinion -- but it is still LAST-TOUCH-ON-ENTRY, not proof of causation:

  * a buyer who read the article on Monday and bought direct on Friday lands on
    the storefront, and the article gets no credit;
  * a buyer who searched the brand, landed on an article, and would have bought
    anyway gets counted as content-driven.

Both errors are inherent to the signal, not bugs in this code, so the UI must
present the number as "orders that started here" and never as "revenue this
article caused". `attributed_path` is stored precisely so a surprising figure
can be explained rather than merely doubted.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.publishing import PublishJob
from app.models.store_order import StoreOrder
from app.services import store_mock
from app.services.shopify_service import SHOPIFY_API_VERSION, get_credentials

logger = logging.getLogger(__name__)

# read_orders only exposes the last 60 days. Anything older needs
# read_all_orders, which requires Shopify's app review.
ORDER_WINDOW_DAYS = 60

# Point of sale, draft orders and the like never had a landing page, so they can
# never be content-attributed. Counting them would inflate the numbers with
# in-person sales.
_NON_WEB_SOURCES = {"pos", "draft_order", "shopify_draft_order", "iphone", "android"}


def normalise_path(url: str | None) -> str | None:
    """The comparable part of a URL: path only, lowercased, no trailing slash.

    Query strings are dropped deliberately. `landing_site` routinely carries
    campaign parameters (`?utm_source=...`), and a published URL never does, so
    comparing raw strings would match almost nothing.
    """
    if not url:
        return None
    path = urlparse(url if "//" in url else f"//{url}").path or "/"
    path = path.rstrip("/").lower()
    return path or "/"


async def _published_paths(project_id: uuid.UUID, db: AsyncSession) -> dict[str, uuid.UUID]:
    """Map of published path -> article id for this project.

    Built from PublishJob rather than Article because an article has no URL of
    its own: the live address only exists once something has been published, and
    that is exactly the set an order could have landed on.
    """
    rows = (await db.execute(
        select(PublishJob.published_url, PublishJob.article_id).where(
            PublishJob.project_id == project_id,
            PublishJob.published_url.isnot(None),
            PublishJob.article_id.isnot(None),
        )
    )).all()
    out: dict[str, uuid.UUID] = {}
    for url, article_id in rows:
        path = normalise_path(url)
        # First writer wins: republishing the same article makes several jobs
        # with the same URL, and they all point at the same article anyway.
        if path and path not in out:
            out[path] = article_id
    return out


def attribute(landing_site: str | None, source_name: str | None,
              paths: dict[str, uuid.UUID]) -> tuple[uuid.UUID | None, str | None]:
    """Resolve one order to an article, or to nothing.

    Returning (None, path) rather than (None, None) is intentional: an order
    that landed on a page we did not publish is a normal outcome, and keeping
    the path makes "why did this not attribute?" answerable.
    """
    if (source_name or "").lower() in _NON_WEB_SOURCES:
        return None, None
    path = normalise_path(landing_site)
    if not path:
        return None, None
    return paths.get(path), path


async def sync_orders(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession,
                      days: int = ORDER_WINDOW_DAYS, limit: int = 250) -> dict:
    """Pull recent orders, attribute them, and upsert.

    Upserts on (project_id, external_id) so a re-run is safe and re-attributes
    orders against whatever has been published since -- an article published
    after an order can still claim it on the next sync.
    """
    creds = await get_credentials(project_id, org_id, db)
    if not creds:
        return {"ok": False, "error": "not_connected", "synced": 0, "attributed": 0}
    domain, token = creds

    since = datetime.now(timezone.utc) - timedelta(days=max(1, min(days, ORDER_WINDOW_DAYS)))
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"https://{domain}/admin/api/{SHOPIFY_API_VERSION}/orders.json",
                params={
                    "status": "any",
                    "limit": max(1, min(limit, 250)),
                    "created_at_min": since.isoformat(),
                    # Only the fields attribution needs. Asking for the whole
                    # order would pull customer names and addresses this feature
                    # never reads.
                    "fields": "id,created_at,total_price,currency,landing_site,"
                              "referring_site,source_name",
                },
                headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"},
            )
            if resp.status_code == 403:
                # The store was connected before read_orders was requested.
                return {"ok": False, "error": "scope_missing", "synced": 0, "attributed": 0}
            resp.raise_for_status()
            orders = (resp.json() or {}).get("orders") or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("shopify order sync failed for project %s: %s", project_id, exc)
        return {"ok": False, "error": str(exc)[:200], "synced": 0, "attributed": 0}

    paths = await _published_paths(project_id, db)
    existing = {
        r.external_id: r for r in (await db.execute(
            select(StoreOrder).where(StoreOrder.project_id == project_id)
        )).scalars().all()
    }

    synced = attributed = 0
    for o in orders:
        ext = str(o.get("id") or "")
        if not ext:
            continue
        article_id, path = attribute(o.get("landing_site"), o.get("source_name"), paths)
        row = existing.get(ext) or StoreOrder(
            org_id=org_id, project_id=project_id, source="shopify", external_id=ext)
        row.total_price = o.get("total_price")
        row.currency = o.get("currency")
        ordered_at = o.get("created_at")
        if ordered_at:
            try:
                row.ordered_at = datetime.fromisoformat(str(ordered_at).replace("Z", "+00:00"))
            except ValueError:
                pass
        row.landing_site = (o.get("landing_site") or "")[:2000] or None
        row.referring_site = (o.get("referring_site") or "")[:2000] or None
        row.source_name = o.get("source_name")
        row.attributed_article_id = article_id
        row.attributed_path = path
        db.add(row)
        synced += 1
        if article_id:
            attributed += 1

    await db.commit()
    return {"ok": True, "synced": synced, "attributed": attributed,
            "window_days": days}


async def revenue_summary(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession,
                          days: int = 30) -> dict:
    """Revenue that started on content, and the articles it started on.

    `attributed` and `total` are both returned on purpose. A share of 12% is not
    a poor result -- most sales never begin on an article -- but a number shown
    without its denominator invites the reader to assume it is one.

    `org_id` is required, not optional. project_id arrives from the query string
    and is guessable, so filtering on it alone would hand any authenticated user
    another organisation's revenue. Every query below derives from `base`, so
    the tenant filter cannot be forgotten on one of them.
    """
    from sqlalchemy import func, case
    from app.models.article import Article

    since = datetime.now(timezone.utc) - timedelta(days=days)
    base = [StoreOrder.org_id == org_id, StoreOrder.project_id == project_id,
            StoreOrder.ordered_at >= since]

    totals = (await db.execute(
        select(func.count(StoreOrder.id), func.coalesce(func.sum(StoreOrder.total_price), 0))
        .where(*base)
    )).one()
    attr = (await db.execute(
        select(func.count(StoreOrder.id), func.coalesce(func.sum(StoreOrder.total_price), 0))
        .where(*base, StoreOrder.attributed_article_id.isnot(None))
    )).one()

    rows = (await db.execute(
        select(
            StoreOrder.attributed_article_id,
            Article.title,
            StoreOrder.attributed_path,
            func.count(StoreOrder.id).label("orders"),
            func.coalesce(func.sum(StoreOrder.total_price), 0).label("revenue"),
        )
        .join(Article, Article.id == StoreOrder.attributed_article_id)
        .where(*base, StoreOrder.attributed_article_id.isnot(None))
        .group_by(StoreOrder.attributed_article_id, Article.title, StoreOrder.attributed_path)
        .order_by(func.coalesce(func.sum(StoreOrder.total_price), 0).desc())
        .limit(20)
    )).all()

    # Daily series for the trend chart. Real data -- attributed and total per
    # day, so the chart shows the gap rather than one line without context.
    day = func.date(StoreOrder.ordered_at)
    daily = (await db.execute(
        select(
            day.label("d"),
            func.coalesce(func.sum(StoreOrder.total_price), 0),
            func.coalesce(func.sum(
                case((StoreOrder.attributed_article_id.isnot(None), StoreOrder.total_price),
                     else_=0)), 0),
        ).where(*base).group_by(day).order_by(day)
    )).all()
    series = [
        {"date": str(r[0]), "revenue": float(r[1] or 0), "attributed": float(r[2] or 0)}
        for r in daily
    ]

    currency = (await db.execute(
        select(StoreOrder.currency).where(*base, StoreOrder.currency.isnot(None)).limit(1)
    )).scalar()

    # Average order value, and the split between orders that began on our
    # content and everything else. AOV is the number a store owner actually
    # manages against, and comparing the two AOVs answers a question the raw
    # totals cannot: whether content brings BIGGER baskets, not just more.
    aov_total = float(totals[1] or 0) / totals[0] if totals[0] else 0.0
    aov_attr = float(attr[1] or 0) / attr[0] if attr[0] else 0.0

    return {
        "window_days": days,
        "currency": currency,
        "aov_total": round(aov_total, 2),
        "aov_attributed": round(aov_attr, 2),
        "orders_total": totals[0] or 0,
        "revenue_total": float(totals[1] or 0),
        "orders_attributed": attr[0] or 0,
        "revenue_attributed": float(attr[1] or 0),
        # Sections with no data source yet. Flagged so the UI can label them:
        # a dashboard showing invented numbers without saying so is the one
        # failure this must not cause. See store_mock for what each needs.
        "series": series,
        "is_mock": True,
        "products": store_mock.mock_products(str(project_id), currency or "USD"),
        "customers": store_mock.mock_customers(str(project_id)),
        "traffic": store_mock.mock_traffic(str(project_id), totals[0] or 0),
        "articles": [
            {"article_id": str(r[0]), "title": r[1], "path": r[2],
             "orders": r[3], "revenue": float(r[4] or 0)}
            for r in rows
        ],
    }
