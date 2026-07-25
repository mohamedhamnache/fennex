import uuid
from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from app.core.dependencies import CurrentUser, DB
from app.core.storage import upload_bytes
from app.models.brand_kit import BrandKit
from app.models.project import Project

router = APIRouter()

ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/svg+xml"}
MAX_LOGO_BYTES = 5 * 1024 * 1024


class BrandKitOut(BaseModel):
    id: uuid.UUID
    logo_url: Optional[str] = None
    colors: list = []
    primary_font: Optional[str] = None
    secondary_font: Optional[str] = None
    style_rules: Optional[str] = None
    tone: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class BrandKitUpdate(BaseModel):
    colors: Optional[list] = None
    primary_font: Optional[str] = None
    secondary_font: Optional[str] = None
    style_rules: Optional[str] = None
    tone: Optional[str] = None


async def get_or_create_for_project(project_id: uuid.UUID, org_id: uuid.UUID, db) -> BrandKit:
    result = await db.execute(
        select(BrandKit).where(BrandKit.project_id == project_id, BrandKit.org_id == org_id)
    )
    kit = result.scalar_one_or_none()
    if kit is None:
        kit = BrandKit(org_id=org_id, project_id=project_id, colors=[])
        db.add(kit)
        await db.flush()
        await db.refresh(kit)
    return kit


async def _resolve_project(project_id: uuid.UUID | None, org_id: uuid.UUID, db) -> uuid.UUID:
    if project_id is not None:
        return project_id
    row = await db.execute(
        select(Project.id).where(Project.org_id == org_id).order_by(Project.created_at.asc()).limit(1)
    )
    pid = row.scalar_one_or_none()
    if pid is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No project for this org")
    return pid


@router.get("", response_model=BrandKitOut)
async def get_brand_kit(current_user: CurrentUser, db: DB, project_id: uuid.UUID | None = None):
    resolved_project_id = await _resolve_project(project_id, current_user.org_id, db)
    kit = await get_or_create_for_project(resolved_project_id, current_user.org_id, db)
    await db.commit()
    return BrandKitOut.model_validate(kit)


@router.put("", response_model=BrandKitOut)
async def update_brand_kit(
    body: BrandKitUpdate, current_user: CurrentUser, db: DB, project_id: uuid.UUID | None = None
):
    resolved_project_id = await _resolve_project(project_id, current_user.org_id, db)
    kit = await get_or_create_for_project(resolved_project_id, current_user.org_id, db)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(kit, field, value)
    await db.flush()
    await db.refresh(kit)
    await db.commit()
    return BrandKitOut.model_validate(kit)


@router.post("/logo", response_model=BrandKitOut)
async def upload_logo(
    file: UploadFile, current_user: CurrentUser, db: DB, project_id: uuid.UUID | None = None
):
    if file.content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo must be PNG, JPG, or SVG")
    content = await file.read()
    if len(content) > MAX_LOGO_BYTES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Logo must be under 5 MB")

    resolved_project_id = await _resolve_project(project_id, current_user.org_id, db)

    ext = (file.filename or "logo.png").rsplit(".", 1)[-1].lower()
    key = f"brand-kit/{current_user.org_id}/{resolved_project_id}/logo.{ext}"
    logo_url = await upload_bytes(content, key, file.content_type or "image/png")

    kit = await get_or_create_for_project(resolved_project_id, current_user.org_id, db)
    kit.logo_url = logo_url
    await db.flush()
    await db.refresh(kit)
    await db.commit()
    return BrandKitOut.model_validate(kit)
