"""Unified content calendar — scheduling authority + CRUD. Publish dispatch lives in calendar_publish.py."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.article import Article
from app.models.calendar_entry import CalendarEntry
from app.models.image import GeneratedImage
from app.models.publishing import PublishingConnection
from app.models.social import SocialPost

VALID_TYPES = {"article", "social", "banner"}
VALID_TARGETS = {"wordpress", "linkedin"}


class CalendarError(Exception):
    pass


async def _content_title(content_type: str, content_id: uuid.UUID, project_id, org_id, db: AsyncSession) -> str | None:
    if content_type == "article":
        row = (await db.execute(select(Article).where(
            Article.id == content_id, Article.org_id == org_id, Article.project_id == project_id))).scalars().first()
        return row.title if row else None
    if content_type == "social":
        row = (await db.execute(select(SocialPost).where(
            SocialPost.id == content_id, SocialPost.org_id == org_id, SocialPost.project_id == project_id))).scalars().first()
        return (row.content[:80] if row else None)
    if content_type == "banner":
        row = (await db.execute(select(GeneratedImage).where(
            GeneratedImage.id == content_id, GeneratedImage.org_id == org_id, GeneratedImage.project_id == project_id))).scalars().first()
        if not row:
            return None
        return (row.caption or row.seo_filename or (row.prompt or "")[:60] or "Banner")
    return None


async def _validate_target(entry: CalendarEntry, org_id, db: AsyncSession) -> None:
    """Raise CalendarError if the entry cannot be armed to 'scheduled'."""
    if entry.target_kind not in VALID_TARGETS:
        raise CalendarError("A publish target is required before scheduling.")
    if entry.target_kind == "wordpress":
        if entry.connection_id is None:
            raise CalendarError("Select a WordPress connection before scheduling.")
        conn = (await db.execute(select(PublishingConnection).where(
            PublishingConnection.id == entry.connection_id, PublishingConnection.org_id == org_id))).scalars().first()
        if conn is None:
            raise CalendarError("The selected connection was not found.")


async def create_entry(project_id, org_id, data: dict, db: AsyncSession) -> CalendarEntry:
    ctype = data["content_type"]
    if ctype not in VALID_TYPES:
        raise CalendarError(f"Unknown content type: {ctype}")
    cid = uuid.UUID(str(data["content_id"]))
    title = await _content_title(ctype, cid, project_id, org_id, db)
    if title is None:
        raise CalendarError("Content not found for this project.")
    entry = CalendarEntry(
        org_id=org_id, project_id=project_id, content_type=ctype, content_id=cid,
        title=title[:500], scheduled_at=data["scheduled_at"],
        timezone=data.get("timezone") or "UTC",
        target_kind=data.get("target_kind"), connection_id=data.get("connection_id"),
        state="planned",
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


async def list_entries(project_id, org_id, start_iso: str, end_iso: str, db: AsyncSession) -> list[CalendarEntry]:
    rows = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.project_id == project_id, CalendarEntry.org_id == org_id,
        CalendarEntry.scheduled_at >= start_iso, CalendarEntry.scheduled_at <= end_iso,
    ).order_by(CalendarEntry.scheduled_at))).scalars().all()
    return list(rows)


async def update_entry(entry_id, org_id, patch: dict, db: AsyncSession) -> CalendarEntry | None:
    entry = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.id == entry_id, CalendarEntry.org_id == org_id))).scalars().first()
    if entry is None:
        return None
    for field in ("scheduled_at", "timezone", "target_kind", "connection_id"):
        if field in patch and patch[field] is not None:
            setattr(entry, field, patch[field])
    if patch.get("state") == "scheduled":
        await _validate_target(entry, org_id, db)
        entry.state = "scheduled"
    elif "state" in patch and patch["state"] in ("planned", "scheduled", "failed"):
        entry.state = patch["state"]
    await db.commit()
    await db.refresh(entry)
    return entry


async def delete_entry(entry_id, org_id, db: AsyncSession) -> bool:
    entry = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.id == entry_id, CalendarEntry.org_id == org_id))).scalars().first()
    if entry is None:
        return False
    await db.delete(entry)
    await db.commit()
    return True
