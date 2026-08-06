"""Scheduled store work: keep synced orders fresh without anyone clicking Sync.

WHY THIS IS NOT OPT-IN, WHEN RANK TRACKING IS. The rank tracker bills SEO
credits for every tracked keyword whether the customer logs in or not, so it
has to be asked for. Shopify's Orders API costs nothing -- no supplier call, no
metering, no credit. The only cost here is our own worker time and a couple of
HTTP calls per store, so making a merchant opt in would be asking permission to
do something free and useful.

WHAT A RE-SYNC ALSO DOES. sync_orders re-attributes every order it upserts
against whatever has been published since. An article published today can
therefore claim orders that landed on its URL yesterday -- attribution improves
on its own, but only if something runs. Before this job existed the whole
dashboard sat on data that was only as fresh as the last manual click.
"""
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.project import Project
from app.models.shopify import ShopifyConnection
from app.models.usage_event import UsageEvent

logger = logging.getLogger(__name__)

# A project nobody has touched in a month does not need its orders kept warm.
# Matches the rank tracker's window so the two jobs agree on what "active"
# means -- a project should not be dormant for one and live for the other.
DORMANT_AFTER_DAYS = 30

# Shopify's read_orders scope only exposes the last 60 days, and re-pulling all
# of it daily is wasted work once the history is in. A week covers any order
# that could still be re-attributed to newly published content, plus a wide
# margin for a job that failed to run.
SYNC_WINDOW_DAYS = 7


async def sync_store_orders(ctx) -> None:
    """Pull recent orders for every active connected store."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=DORMANT_AFTER_DAYS)

    async with async_session_factory() as db:
        # Unlike the rank tracker, this job writes no usage events of its own,
        # so there is nothing to exclude here: it cannot keep a dormant project
        # alive by its own activity.
        active = select(UsageEvent.project_id).where(
            UsageEvent.ts >= cutoff,
            UsageEvent.project_id.isnot(None),
        ).distinct()

        rows = (await db.execute(
            select(Project.id, Project.org_id, Project.name)
            .join(ShopifyConnection, ShopifyConnection.project_id == Project.id)
            .where(ShopifyConnection.is_active.is_(True), Project.id.in_(active))
            .distinct()
        )).all()

    logger.info("store sync: %d connected store(s) after the %d-day dormancy filter",
                len(rows), DORMANT_AFTER_DAYS)

    synced = attributed = failed = 0
    for project_id, org_id, name in rows:
        try:
            async with async_session_factory() as db:
                from app.services.store_revenue_service import sync_orders
                result = await sync_orders(project_id, org_id, db, days=SYNC_WINDOW_DAYS)
            if result.get("ok"):
                synced += result.get("synced", 0)
                attributed += result.get("attributed", 0)
            else:
                failed += 1
                # scope_missing means the store was connected before read_orders
                # was requested. It is a permanent condition until the merchant
                # reconnects, so it is logged plainly rather than as an error
                # anyone should chase.
                logger.info("store sync skipped for %s (%s): %s",
                            name, project_id, result.get("error"))
        except Exception:  # noqa: BLE001 - one store must not break the batch
            failed += 1
            logger.exception("store sync failed for project %s", project_id)

    logger.info("store sync: %d order(s) upserted, %d attributed to content, %d store(s) failed",
                synced, attributed, failed)
