"""Weekly persona digest emails — sent for every project with an active GSC sync."""
from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.analytics import GscConnection
from app.services.digest_service import send_project_digest


async def send_weekly_digests(ctx):
    """ARQ cron: email each connected project's weekly digest to its org users."""
    async with async_session_factory() as db:
        result = await db.execute(
            select(GscConnection.project_id).where(GscConnection.is_active.is_(True))
        )
        project_ids = [r[0] for r in result.all()]

    sent_total = 0
    for pid in project_ids:
        async with async_session_factory() as db:
            try:
                r = await send_project_digest(pid, db)
                sent_total += r.get("sent", 0)
            except Exception:
                continue  # one bad project shouldn't stop the batch
    return {"projects": len(project_ids), "emails_sent": sent_total}
