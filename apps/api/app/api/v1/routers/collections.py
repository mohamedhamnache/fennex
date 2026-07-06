import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update

from app.core.dependencies import CurrentUser, DB
from app.models.image_collection import ImageCollection
from app.models.image import GeneratedImage
from app.api.v1.routers.images import ImageOut

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class CollectionOut(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    name: str
    description: Optional[str] = None
    image_count: int = 0
    cover_url: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class CollectionDetail(CollectionOut):
    images: list[ImageOut] = []


class CollectionCreate(BaseModel):
    project_id: uuid.UUID
    name: str
    description: Optional[str] = None
    image_ids: list[uuid.UUID] = []


class CollectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class CollectionImages(BaseModel):
    image_ids: list[uuid.UUID]


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_collection_or_404(collection_id: uuid.UUID, org_id: uuid.UUID, db) -> ImageCollection:
    result = await db.execute(
        select(ImageCollection).where(
            ImageCollection.id == collection_id,
            ImageCollection.org_id == org_id,
        )
    )
    col = result.scalar_one_or_none()
    if col is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Collection not found")
    return col


async def _assign_images(image_ids: list[uuid.UUID], collection_id: Optional[uuid.UUID], org_id: uuid.UUID, db):
    if not image_ids:
        return
    await db.execute(
        update(GeneratedImage)
        .where(GeneratedImage.id.in_(image_ids), GeneratedImage.org_id == org_id)
        .values(collection_id=collection_id)
    )


async def _images_of(collection_id: uuid.UUID, org_id: uuid.UUID, db) -> list[GeneratedImage]:
    result = await db.execute(
        select(GeneratedImage)
        .where(
            GeneratedImage.collection_id == collection_id,
            GeneratedImage.org_id == org_id,
            GeneratedImage.is_deleted.is_(False),
        )
        .order_by(GeneratedImage.created_at)
    )
    return list(result.scalars().all())


def _summary(col: ImageCollection, images: list[GeneratedImage]) -> CollectionOut:
    cover = next((i.thumbnail_url or i.image_url for i in images if (i.thumbnail_url or i.image_url)), None)
    return CollectionOut(
        id=col.id,
        project_id=col.project_id,
        name=col.name,
        description=col.description,
        image_count=len(images),
        cover_url=cover,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("", response_model=list[CollectionOut])
async def list_collections(current_user: CurrentUser, db: DB, project_id: uuid.UUID = Query(...)):
    result = await db.execute(
        select(ImageCollection)
        .where(
            ImageCollection.org_id == current_user.org_id,
            ImageCollection.project_id == project_id,
        )
        .order_by(ImageCollection.created_at.desc())
    )
    collections = result.scalars().all()
    out: list[CollectionOut] = []
    for col in collections:
        images = await _images_of(col.id, current_user.org_id, db)
        out.append(_summary(col, images))
    return out


@router.post("", response_model=CollectionDetail, status_code=201)
async def create_collection(body: CollectionCreate, current_user: CurrentUser, db: DB):
    if not body.name.strip():
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Name cannot be empty")
    col = ImageCollection(
        org_id=current_user.org_id,
        project_id=body.project_id,
        name=body.name.strip(),
        description=body.description,
    )
    db.add(col)
    await db.flush()
    await db.refresh(col)
    await _assign_images(body.image_ids, col.id, current_user.org_id, db)
    await db.commit()

    images = await _images_of(col.id, current_user.org_id, db)
    summary = _summary(col, images)
    return CollectionDetail(**summary.model_dump(), images=[ImageOut.model_validate(i) for i in images])


@router.get("/{collection_id}", response_model=CollectionDetail)
async def get_collection(collection_id: uuid.UUID, current_user: CurrentUser, db: DB):
    col = await _get_collection_or_404(collection_id, current_user.org_id, db)
    images = await _images_of(col.id, current_user.org_id, db)
    summary = _summary(col, images)
    return CollectionDetail(**summary.model_dump(), images=[ImageOut.model_validate(i) for i in images])


@router.patch("/{collection_id}", response_model=CollectionOut)
async def update_collection(collection_id: uuid.UUID, body: CollectionUpdate, current_user: CurrentUser, db: DB):
    col = await _get_collection_or_404(collection_id, current_user.org_id, db)
    if body.name is not None:
        col.name = body.name.strip() or col.name
    if body.description is not None:
        col.description = body.description
    await db.flush()
    await db.commit()
    images = await _images_of(col.id, current_user.org_id, db)
    return _summary(col, images)


@router.post("/{collection_id}/images", response_model=CollectionDetail)
async def add_images(collection_id: uuid.UUID, body: CollectionImages, current_user: CurrentUser, db: DB):
    col = await _get_collection_or_404(collection_id, current_user.org_id, db)
    await _assign_images(body.image_ids, col.id, current_user.org_id, db)
    await db.commit()
    images = await _images_of(col.id, current_user.org_id, db)
    summary = _summary(col, images)
    return CollectionDetail(**summary.model_dump(), images=[ImageOut.model_validate(i) for i in images])


@router.delete("/{collection_id}/images/{image_id}", status_code=204)
async def remove_image(collection_id: uuid.UUID, image_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await _get_collection_or_404(collection_id, current_user.org_id, db)
    await db.execute(
        update(GeneratedImage)
        .where(
            GeneratedImage.id == image_id,
            GeneratedImage.collection_id == collection_id,
            GeneratedImage.org_id == current_user.org_id,
        )
        .values(collection_id=None)
    )
    await db.commit()
    return None


@router.delete("/{collection_id}", status_code=204)
async def delete_collection(collection_id: uuid.UUID, current_user: CurrentUser, db: DB):
    col = await _get_collection_or_404(collection_id, current_user.org_id, db)
    # Unlink images (keep them in the library), then delete the collection
    await db.execute(
        update(GeneratedImage)
        .where(GeneratedImage.collection_id == col.id, GeneratedImage.org_id == current_user.org_id)
        .values(collection_id=None)
    )
    await db.delete(col)
    await db.commit()
    return None
