import uuid

from fastapi import APIRouter
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.services import woocommerce_service

router = APIRouter()


class WooConnectRequest(BaseModel):
    project_id: uuid.UUID
    store_url: str
    consumer_key: str
    consumer_secret: str


class WooStatus(BaseModel):
    connected: bool
    store_url: str | None = None
    shop_name: str | None = None
    last_tested_at: str | None = None


class WooConnectResult(BaseModel):
    ok: bool
    error: str | None = None
    detail: str | None = None
    store_url: str | None = None
    shop_name: str | None = None


@router.get("/status", response_model=WooStatus)
async def woo_status(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await woocommerce_service.get_status(project_id, current_user.org_id, db)


@router.post("/connect", response_model=WooConnectResult)
async def woo_connect(body: WooConnectRequest, current_user: CurrentUser, db: DB):
    return await woocommerce_service.connect(
        body.project_id, current_user.org_id, body.store_url, body.consumer_key, body.consumer_secret, db
    )


@router.delete("/disconnect", status_code=204)
async def woo_disconnect(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await woocommerce_service.disconnect(project_id, current_user.org_id, db)
