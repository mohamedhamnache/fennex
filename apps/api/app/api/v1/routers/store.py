import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.services import store_service

router = APIRouter()


class StoreProductOut(BaseModel):
    id: uuid.UUID
    source: str
    external_id: str
    title: str
    handle: str | None = None
    description: str | None = None
    image_url: str | None = None
    price: str | None = None
    status: str | None = None

    class Config:
        from_attributes = True


class SyncResult(BaseModel):
    ok: bool
    error: str | None = None
    synced: int = 0


class ProductCopyResult(BaseModel):
    ok: bool
    error: str | None = None
    title: str | None = None
    description_html: str | None = None
    meta_description: str | None = None


class PublishCopyRequest(BaseModel):
    project_id: uuid.UUID
    title: str
    description_html: str


class PublishCopyResult(BaseModel):
    ok: bool
    error: str | None = None


@router.get("/products", response_model=list[StoreProductOut])
async def store_list_products(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await store_service.list_products(project_id, current_user.org_id, db)


@router.post("/products/sync", response_model=SyncResult)
async def store_sync_products(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await store_service.sync_all(project_id, current_user.org_id, db)


@router.post("/products/{product_id}/copy", response_model=ProductCopyResult)
async def store_generate_copy(product_id: uuid.UUID, project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await store_service.generate_copy(product_id, project_id, current_user.org_id, db)


@router.post("/products/{product_id}/publish-copy", response_model=PublishCopyResult)
async def store_publish_copy(product_id: uuid.UUID, body: PublishCopyRequest, current_user: CurrentUser, db: DB):
    return await store_service.publish_copy(
        product_id, body.project_id, current_user.org_id, body.title, body.description_html, db
    )
