import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.services import calendar_service as svc
from app.services.calendar_publish import publish_entry

router = APIRouter()


class EntryCreate(BaseModel):
    content_type: str
    content_id: str
    scheduled_at: str
    timezone: Optional[str] = None
    target_kind: Optional[str] = None
    connection_id: Optional[str] = None


class EntryPatch(BaseModel):
    scheduled_at: Optional[str] = None
    timezone: Optional[str] = None
    target_kind: Optional[str] = None
    connection_id: Optional[str] = None
    state: Optional[str] = None


def _serialize(e) -> dict:
    return {
        "id": str(e.id), "content_type": e.content_type, "content_id": str(e.content_id),
        "title": e.title, "scheduled_at": e.scheduled_at, "timezone": e.timezone,
        "target_kind": e.target_kind, "connection_id": str(e.connection_id) if e.connection_id else None,
        "state": e.state, "error": e.error, "published_at": e.published_at, "published_url": e.published_url,
    }


@router.get("")
async def list_calendar(project_id: uuid.UUID, start: str, end: str, current_user: CurrentUser, db: DB):
    rows = await svc.list_entries(project_id, current_user.org_id, start, end, db)
    return [_serialize(r) for r in rows]


@router.post("", status_code=201)
async def create_calendar(project_id: uuid.UUID, body: EntryCreate, current_user: CurrentUser, db: DB):
    try:
        entry = await svc.create_entry(project_id, current_user.org_id, body.model_dump(), db)
    except svc.CalendarError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    return _serialize(entry)


@router.patch("/{entry_id}")
async def patch_calendar(entry_id: uuid.UUID, body: EntryPatch, current_user: CurrentUser, db: DB):
    try:
        entry = await svc.update_entry(entry_id, current_user.org_id, body.model_dump(exclude_none=True), db)
    except svc.CalendarError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    return _serialize(entry)


@router.delete("/{entry_id}", status_code=204)
async def delete_calendar(entry_id: uuid.UUID, current_user: CurrentUser, db: DB):
    ok = await svc.delete_entry(entry_id, current_user.org_id, db)
    if not ok:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")


@router.post("/{entry_id}/publish-now")
async def publish_now(entry_id: uuid.UUID, current_user: CurrentUser, db: DB):
    from sqlalchemy import select
    from app.models.calendar_entry import CalendarEntry
    entry = (await db.execute(select(CalendarEntry).where(
        CalendarEntry.id == entry_id, CalendarEntry.org_id == current_user.org_id))).scalars().first()
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entry not found")
    if entry.state == "planned":
        try:
            await svc._validate_target(entry, current_user.org_id, db)  # noqa: SLF001 — reuse gate
        except svc.CalendarError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
        entry.state = "scheduled"
    result = await publish_entry(entry, db)
    return _serialize(result)
