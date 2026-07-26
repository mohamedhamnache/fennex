"""Staff-only CRUD for the band -> model map. Repointing a supplier is a row
change here, not a deploy. Every write invalidates the resolver snapshot."""
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.models.model_catalog import ModelCatalog
from app.services.providers import catalog

router = APIRouter()


def _require_staff(current_user: CurrentUser) -> None:
    admin_emails = {e.lower() for e in (settings.PLATFORM_ADMIN_EMAILS or [])}
    if current_user.email.lower() not in admin_emails:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Staff only")


def _validate_band(band: str) -> str:
    if band not in catalog.BANDS:
        raise HTTPException(status_code=422,
                            detail=f"band must be one of {', '.join(catalog.BANDS)}")
    return band


class EntryIn(BaseModel):
    band: str
    provider: str
    model: str
    priority: int = 100
    supports: dict = {}
    is_active: bool = True


class EntryPatch(BaseModel):
    band: str
    provider: str
    model: str
    priority: int | None = None
    supports: dict | None = None
    is_active: bool | None = None


def _out(row: ModelCatalog) -> dict:
    return {"band": row.band, "provider": row.provider, "model": row.model,
            "priority": row.priority, "supports": row.supports or {},
            "is_active": row.is_active}


@router.get("")
async def list_entries(current_user: CurrentUser, db: DB) -> list[dict]:
    _require_staff(current_user)
    rows = (await db.execute(select(ModelCatalog).order_by(
        ModelCatalog.band, ModelCatalog.priority))).scalars().all()
    return [_out(r) for r in rows]


@router.post("", status_code=201)
async def create_entry(body: EntryIn, current_user: CurrentUser, db: DB) -> dict:
    _require_staff(current_user)
    _validate_band(body.band)
    row = ModelCatalog(band=body.band, provider=body.provider, model=body.model,
                       priority=body.priority, supports=body.supports,
                       is_active=body.is_active)
    db.add(row)
    await db.commit()
    await catalog.refresh_snapshot(db)
    return _out(row)


@router.patch("")
async def update_entry(body: EntryPatch, current_user: CurrentUser, db: DB) -> dict:
    _require_staff(current_user)
    _validate_band(body.band)
    row = await db.get(ModelCatalog, (body.band, body.provider, body.model))
    if row is None:
        raise HTTPException(status_code=404, detail="Catalog entry not found")
    if body.priority is not None:
        row.priority = body.priority
    if body.supports is not None:
        row.supports = body.supports
    if body.is_active is not None:
        row.is_active = body.is_active
    await db.commit()
    await catalog.refresh_snapshot(db)
    return _out(row)


@router.delete("", status_code=204)
async def delete_entry(band: str, provider: str, model: str,
                       current_user: CurrentUser, db: DB) -> None:
    _require_staff(current_user)
    row = await db.get(ModelCatalog, (band, provider, model))
    if row is not None:
        await db.delete(row)
        await db.commit()
    catalog.invalidate_snapshot()
