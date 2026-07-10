"""Monday-morning autopilot planning for all opted-in projects."""
import logging

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.project import Project
from app.services.autopilot_service import generate_weekly_plan

logger = logging.getLogger(__name__)


async def run_autopilot_planner(ctx) -> None:
    async with async_session_factory() as db:
        projects = (await db.execute(
            select(Project).where(Project.autopilot_enabled.is_(True))
        )).scalars().all()
    for project in projects:
        try:
            async with async_session_factory() as db:
                await generate_weekly_plan(project, db)
        except Exception:  # noqa: BLE001 - one project must not break the batch
            logger.exception("autopilot planning failed for project %s", project.id)
