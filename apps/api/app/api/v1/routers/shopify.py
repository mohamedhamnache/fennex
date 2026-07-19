import uuid

from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.services import shopify_service

router = APIRouter()


class ShopifyConnectRequest(BaseModel):
    project_id: uuid.UUID
    shop_domain: str
    # New 2026 Dev Dashboard model: client-credentials app
    client_id: str | None = None
    client_secret: str | None = None
    # Legacy admin custom-app token (still accepted if a store has one)
    access_token: str | None = None


class ShopifyStatus(BaseModel):
    connected: bool
    shop_domain: str | None = None
    shop_name: str | None = None
    last_tested_at: str | None = None
    oauth_available: bool = False


class ShopifyOAuthStartRequest(BaseModel):
    project_id: uuid.UUID
    shop_domain: str


class ShopifyOAuthStartResult(BaseModel):
    ok: bool
    error: str | None = None
    redirect_url: str | None = None


class ShopifyConnectResult(BaseModel):
    ok: bool
    error: str | None = None
    detail: str | None = None
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


@router.get("/status", response_model=ShopifyStatus)
async def shopify_status(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await shopify_service.get_status(project_id, current_user.org_id, db)


@router.post("/connect", response_model=ShopifyConnectResult)
async def shopify_connect(body: ShopifyConnectRequest, current_user: CurrentUser, db: DB):
    return await shopify_service.connect(
        body.project_id, current_user.org_id, body.shop_domain, db,
        client_id=body.client_id,
        client_secret=body.client_secret,
        access_token=body.access_token,
    )


@router.delete("/disconnect", status_code=204)
async def shopify_disconnect(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    await shopify_service.disconnect(project_id, current_user.org_id, db)


# ── OAuth "Connect with Shopify" (one-click install) ─────────────────────────

@router.post("/oauth/start", response_model=ShopifyOAuthStartResult)
async def shopify_oauth_start(body: ShopifyOAuthStartRequest, current_user: CurrentUser):
    """Return the Shopify authorize/install URL the merchant is redirected to."""
    if not shopify_service.oauth_configured():
        return {"ok": False, "error": "oauth_not_configured"}
    domain = shopify_service._normalize_domain(body.shop_domain)
    if not domain:
        return {"ok": False, "error": "invalid_domain"}
    # state ties the callback back to this project/org; the callback verifies
    # Shopify's HMAC for authenticity. Only URL-safe chars (UUIDs + dot).
    state = f"{body.project_id}.{current_user.org_id}"
    return {"ok": True, "redirect_url": shopify_service.build_authorize_url(domain, state)}


@router.get("/oauth/callback")
async def shopify_oauth_callback(request: Request, db: DB):
    """Shopify redirects the merchant here after they approve the install."""
    params = dict(request.query_params)
    fail = f"{settings.FRONTEND_URL}/integrations?shopify_error="

    shop = shopify_service._normalize_domain(params.get("shop", ""))
    code = params.get("code")
    state = params.get("state", "")
    if not shop or not code or "." not in state:
        return RedirectResponse(f"{fail}missing_params")
    if not shopify_service.verify_oauth_hmac(params):
        return RedirectResponse(f"{fail}bad_hmac")

    project_part, _, org_part = state.partition(".")
    try:
        project_id = uuid.UUID(project_part)
        org_id = uuid.UUID(org_part)
    except ValueError:
        return RedirectResponse(f"{fail}invalid_state")

    dest = f"{settings.FRONTEND_URL}/{project_id}/integrations"
    try:
        access_token = await shopify_service.exchange_oauth_code(shop, code)
    except Exception:  # noqa: BLE001
        return RedirectResponse(f"{dest}?shopify_error=token_exchange_failed")
    await shopify_service.store_oauth_connection(project_id, org_id, shop, access_token, db)
    return RedirectResponse(f"{dest}?shopify=connected")


@router.get("/products", response_model=list[StoreProductOut])
async def shopify_list_products(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await shopify_service.list_products(project_id, current_user.org_id, db)


@router.post("/products/sync", response_model=SyncResult)
async def shopify_sync_products(project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await shopify_service.sync_products(project_id, current_user.org_id, db)


@router.post("/products/{product_id}/copy", response_model=ProductCopyResult)
async def shopify_generate_copy(product_id: uuid.UUID, project_id: uuid.UUID, current_user: CurrentUser, db: DB):
    return await shopify_service.generate_copy(product_id, project_id, current_user.org_id, db)


@router.post("/products/{product_id}/publish-copy", response_model=PublishCopyResult)
async def shopify_publish_copy(product_id: uuid.UUID, body: PublishCopyRequest, current_user: CurrentUser, db: DB):
    return await shopify_service.publish_copy(
        product_id, body.project_id, current_user.org_id, body.title, body.description_html, db
    )
