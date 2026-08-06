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
                # Background/cron rank tracking must still be metered for
                # cost visibility but must never consume the enforced SEO
                # credit bucket -- only user-initiated work (e.g. the
                # /refresh endpoint) does that. See rank_tracking_service.
                #
                # The cost is real and guaranteed: it is committed for every
                # tracked keyword whether the customer logs in or not, and it
                # scales with the plan's keyword cap rather than with usage. On
                # Scale that is ~$260/month, a third of the plan price, before
                # the first request. test_scheduled_work_is_counted_against_
                # plan_margin pins that ratio so raising a keyword cap or the
                # cron frequency fails a test instead of eroding margin
                # silently. The three levers are the cap, the frequency, and
                # billing it.
                from app.services.rank_tracking_service import CRON_SERP_DEPTH
                await snapshot_project(project, db, bill_credits=False,
                                       depth=CRON_SERP_DEPTH)
        except Exception:  # noqa: BLE001 - one project must not break the batch
            logger.exception("rank tracker failed for project %s", project.id)
