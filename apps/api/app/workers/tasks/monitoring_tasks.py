"""Weekly monitoring crons: Sable competitor re-scans, Oasis market shifts."""
import logging

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.analytics import GscConnection
from app.models.monitoring import WatchedCompetitor
from app.models.project import Project
from app.services.monitoring_service import detect_competitors, detect_market

logger = logging.getLogger(__name__)


async def run_market_monitor(ctx) -> None:
    async with async_session_factory() as db:
        projects = (await db.execute(
            select(Project).join(GscConnection, GscConnection.project_id == Project.id)
            .where(GscConnection.is_active.is_(True))
        )).scalars().all()
    for p in projects:
        try:
            async with async_session_factory() as db:
                await detect_market(p.id, p.org_id, db)
        except Exception:  # noqa: BLE001 - one project must not break the batch
            logger.exception("market monitor failed for project %s", p.id)


async def run_competitor_monitor(ctx) -> None:
    async with async_session_factory() as db:
        projects = (await db.execute(
            select(Project).join(WatchedCompetitor, WatchedCompetitor.project_id == Project.id)
            .distinct()
        )).scalars().all()
    for p in projects:
        try:
            async with async_session_factory() as db:
                await detect_competitors(p.id, p.org_id, db)
        except Exception:  # noqa: BLE001
            logger.exception("competitor monitor failed for project %s", p.id)
