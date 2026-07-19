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
