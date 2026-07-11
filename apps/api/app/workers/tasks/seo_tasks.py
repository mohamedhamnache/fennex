"""Daily SERP rank-tracker cron: Zerda snapshots tracked keywords and alerts on movement."""
import logging

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.project import Project
from app.models.seo_intel import TrackedKeyword
from app.services.rank_tracking_service import snapshot_project

logger = logging.getLogger(__name__)


async def run_rank_tracker(ctx) -> None:
    async with async_session_factory() as db:
        projects = (await db.execute(
            select(Project).join(TrackedKeyword, TrackedKeyword.project_id == Project.id)
            .where(TrackedKeyword.is_active.is_(True))
            .distinct()
        )).scalars().all()
    for project in projects:
        try:
            async with async_session_factory() as db:
                await snapshot_project(project, db)
        except Exception:  # noqa: BLE001 - one project must not break the batch
            logger.exception("rank tracker failed for project %s", project.id)
