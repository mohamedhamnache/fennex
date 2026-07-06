import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update

from app.core.dependencies import CurrentUser, DB
from app.models.image_folder import ImageFolder
from app.models.image import GeneratedImage

router = APIRouter()


class FolderOut(BaseModel):
    id: uuid.UUID
    name: str
    parent_id: Optional[uuid.UUID] = None
    color: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[uuid.UUID] = None
    color: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[uuid.UUID] = None
    color: Optional[str] = None


@router.get("", response_model=list[FolderOut])
async def list_folders(current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(ImageFolder)
        .where(ImageFolder.org_id == current_user.org_id)
        .order_by(ImageFolder.created_at)
    )
    return [FolderOut.model_validate(f) for f in result.scalars().all()]


@router.post("", response_model=FolderOut, status_code=201)
async def create_folder(body: FolderCreate, current_user: CurrentUser, db: DB):
    folder = ImageFolder(
        org_id=current_user.org_id,
        name=body.name,
        parent_id=body.parent_id,
        color=body.color,
    )
    db.add(folder)
    await db.flush()
    await db.refresh(folder)
    await db.commit()
    return FolderOut.model_validate(folder)


@router.patch("/{folder_id}", response_model=FolderOut)
async def update_folder(folder_id: uuid.UUID, body: FolderUpdate, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(ImageFolder).where(
            ImageFolder.id == folder_id,
            ImageFolder.org_id == current_user.org_id,
        )
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(folder, k, v)
    await db.flush()
    await db.refresh(folder)
    await db.commit()
    return FolderOut.model_validate(folder)


@router.delete("/{folder_id}", status_code=204)
async def delete_folder(folder_id: uuid.UUID, current_user: CurrentUser, db: DB):
    result = await db.execute(
        select(ImageFolder).where(
            ImageFolder.id == folder_id,
            ImageFolder.org_id == current_user.org_id,
        )
    )
    folder = result.scalar_one_or_none()
    if not folder:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")
    # Soft-delete all images belonging to this folder
    await db.execute(
        update(GeneratedImage)
        .where(
            GeneratedImage.folder_id == folder_id,
            GeneratedImage.org_id == current_user.org_id,
        )
        .values(is_deleted=True)
    )
    await db.delete(folder)
    await db.commit()
