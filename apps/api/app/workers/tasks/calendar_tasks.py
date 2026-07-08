"""Auto-publish scheduler: publish calendar entries that are due and scheduled."""
from datetime import datetime, timezone

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.calendar_entry import CalendarEntry
from app.services.calendar_publish import publish_entry


async def publish_due(db, now_iso: str) -> int:
    """Publish all scheduled entries with scheduled_at <= now_iso. Returns count attempted."""
    rows = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.state == "scheduled",
        CalendarEntry.scheduled_at <= now_iso,
    ).limit(50))).scalars().all()
    count = 0
    for entry in rows:
        try:
            await publish_entry(entry, db)
        except Exception:
            pass  # publish_entry records failure on the entry; never break the batch
        count += 1
    return count


async def run_content_scheduler(ctx):
    now_iso = datetime.now(timezone.utc).isoformat()
    async with async_session_factory() as db:
        await publish_due(db, now_iso)
