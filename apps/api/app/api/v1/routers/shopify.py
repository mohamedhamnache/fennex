import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.services import shopify_service

router = APIRouter()


class ShopifyConnectRequest(BaseModel):
    project_id: uuid.UUID
    shop_domain: str
    access_token: str


class ShopifyStatus(BaseModel):
    connected: bool
    shop_domain: str | None = None
    shop_name: str | None = None
    last_tested_at: str | None = None


class ShopifyConnectResult(BaseModel):
    ok: bool
    error: str | None = None
    shop_domain: str | None = None
    shop_name: str | None = None


class StoreProductOut(BaseModel):
    id: uuid.UUID
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


@router.get("/status", response_model=ShopifyStatus)
async def shopify_status(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await shopify_service.get_status(project_id, current_user.org_id, db)


@router.post("/connect", response_model=ShopifyConnectResult)
async def shopify_connect(body: ShopifyConnectRequest, current_user: CurrentUser, db: DB):
    return await shopify_service.connect(
        body.project_id, current_user.org_id, body.shop_domain, body.access_token, db
    )


@router.delete("/disconnect", status_code=204)
async def shopify_disconnect(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await shopify_service.disconnect(project_id, current_user.org_id, db)


@router.get("/products", response_model=list[StoreProductOut])
async def shopify_list_products(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await shopify_service.list_products(project_id, current_user.org_id, db)


@router.post("/products/sync", response_model=SyncResult)
async def shopify_sync_products(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await shopify_service.sync_products(project_id, current_user.org_id, db)
