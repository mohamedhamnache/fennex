"""Daily SERP rank-tracker cron: Zerda snapshots tracked keywords and alerts on movement."""
import logging

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.project import Project
from app.models.seo_intel import TrackedKeyword
from app.services.rank_tracking_service import snapshot_project

logger = logging.getLogger(__name__)


# A project nobody has touched in this long is not worth refreshing. Every
# tracked keyword on it is a paid SERP task every week, so a workspace someone
# abandoned in January is pure cost with no reader.
DORMANT_AFTER_DAYS = 30


async def run_rank_tracker(ctx) -> None:
    from datetime import datetime, timedelta, timezone
    from app.models.usage_event import UsageEvent

    cutoff = datetime.now(timezone.utc) - timedelta(days=DORMANT_AFTER_DAYS)
    async with async_session_factory() as db:
        # Activity is judged from the usage ledger, which records every billable
        # action a person took on the project.
        #
        # The cron's OWN events are excluded, and that exclusion is what makes
        # this work: this job writes a usage_event per keyword even when it
        # bills nothing, so counting those would let every project keep itself
        # alive forever and the filter would never skip anything.
        active = select(UsageEvent.project_id).where(
            UsageEvent.ts >= cutoff,
            UsageEvent.project_id.isnot(None),
            UsageEvent.feature.notin_(("rank_check", "rank_check_standard")),
        ).distinct()

        projects = (await db.execute(
            select(Project).join(TrackedKeyword, TrackedKeyword.project_id == Project.id)
            .where(TrackedKeyword.is_active.is_(True), Project.id.in_(active))
            .distinct()
        )).scalars().all()
    logger.info("rank tracker: %d active project(s) after the %d-day dormancy filter",
                len(projects), DORMANT_AFTER_DAYS)
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
                # Standard queue: $0.0006/page against Live's $0.002. Nobody
                # is waiting on a 05:30 job, so the 3.3x latency premium buys
                # nothing.
                await snapshot_project(project, db, bill_credits=False,
                                       depth=CRON_SERP_DEPTH, standard_queue=True)
        except Exception:  # noqa: BLE001 - one project must not break the batch
            logger.exception("rank tracker failed for project %s", project.id)
