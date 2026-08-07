"""Put a campaign's timeline on the content calendar.

Two calendars for one team is two answers to "what is happening on Thursday",
and they drift the moment anyone edits one. So a campaign's dated steps are
mirrored onto the content calendar as planned entries.

WHAT MIRRORING MEANS HERE. The campaign timeline is the source of truth: steps
are stored relative to launch, which is what makes them portable, and the
calendar entry is a projection of that onto real dates. Sync is therefore
one-way and idempotent -- it rewrites this campaign's entries from its tasks
rather than merging, so moving a step in the campaign moves it on the calendar
and never leaves an orphan behind at the old date.

A mirrored step can never be ARMED. There is nothing to publish: it is "produce
the creative", not a post. The calendar refuses to schedule it (see
calendar_service._validate_target), which keeps the publish pipeline honest.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.calendar_entry import CalendarEntry
from app.models.campaign import Campaign, CampaignTask

logger = logging.getLogger(__name__)

# Steps land mid-morning rather than at midnight: a calendar showing everything
# at 00:00 sorts correctly and reads as though nothing was scheduled on purpose.
STEP_HOUR = 9


async def sync(campaign: Campaign, db: AsyncSession) -> int:
    """Mirror the campaign's timeline onto the calendar. Returns entries written.

    A campaign with no start date has no real dates to project onto, so nothing
    is written -- and any entries from a previous sync are removed, because a
    campaign that lost its date should not leave ghosts on the calendar.
    """
    existing = list((await db.execute(select(CalendarEntry).where(
        CalendarEntry.project_id == campaign.project_id,
        CalendarEntry.org_id == campaign.org_id,
        CalendarEntry.content_type == "campaign_task",
    ))).scalars().all())

    tasks = list((await db.execute(select(CampaignTask).where(
        CampaignTask.campaign_id == campaign.id))).scalars().all())
    task_ids = {t.id for t in tasks}

    # Only this campaign's entries are ours to touch. Another campaign's steps
    # are also `campaign_task` rows and must survive untouched.
    mine = [e for e in existing if e.content_id in task_ids]

    if not campaign.starts_on:
        for entry in mine:
            await db.delete(entry)
        await db.flush()
        return 0

    by_task = {e.content_id: e for e in mine}
    written = 0
    for task in tasks:
        when = datetime.combine(
            campaign.starts_on + timedelta(days=task.day_offset),
            time(hour=STEP_HOUR), tzinfo=timezone.utc).isoformat()
        entry = by_task.get(task.id)
        if entry is None:
            db.add(CalendarEntry(
                org_id=campaign.org_id, project_id=campaign.project_id,
                content_type="campaign_task", content_id=task.id,
                title=task.title[:500], scheduled_at=when, timezone="UTC",
                state="planned"))
        else:
            entry.scheduled_at = when
            entry.title = task.title[:500]
        written += 1

    # A step deleted from the campaign leaves the calendar too.
    for content_id, entry in by_task.items():
        if content_id not in task_ids:
            await db.delete(entry)

    await db.flush()
    return written


async def sync_quietly(campaign_id: uuid.UUID, db: AsyncSession) -> None:
    """Sync without ever failing the caller.

    Calendar mirroring is a convenience. A campaign edit must not fail because
    the projection could not be written.
    """
    try:
        campaign = (await db.execute(select(Campaign).where(
            Campaign.id == campaign_id))).scalars().first()
        if campaign is not None:
            await sync(campaign, db)
    except Exception:  # noqa: BLE001
        logger.exception("campaign calendar sync failed: %s", campaign_id)
