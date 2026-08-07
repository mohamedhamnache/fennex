"""Connecting tools to the AI employees."""

import logging

import uuid

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.core.config import settings
from app.core.dependencies import CurrentUser, DB
from app.services import connector_oauth, connector_service

logger = logging.getLogger(__name__)

router = APIRouter()


class ConnectRequest(BaseModel):
    app: str
    url: str
    # Omit to keep the stored credential when only the URL is changing.
    token: str | None = None


class ToggleRequest(BaseModel):
    enabled: bool


@router.get("")
async def list_catalogue(current_user: CurrentUser, db: DB) -> dict:
    """Every connectable tool, its state, and which employees it would reach."""
    return {"connectors": await connector_service.catalogue(current_user.org_id, db)}


@router.post("")
async def connect(body: ConnectRequest, current_user: CurrentUser, db: DB) -> dict:
    try:
        row = await connector_service.connect(
            current_user.org_id, body.app, body.url, body.token, db)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    # Verify immediately: a bad URL should surface here, not mid-conversation.
    result = await connector_service.test(current_user.org_id, row.app, db)
    return {"app": row.app, "connected": True, "test": result}


@router.post("/{app}/test")
async def test(app: str, current_user: CurrentUser, db: DB) -> dict:
    return await connector_service.test(current_user.org_id, app, db)


@router.patch("/{app}")
async def toggle(app: str, body: ToggleRequest, current_user: CurrentUser, db: DB) -> dict:
    row = await connector_service.set_enabled(current_user.org_id, app, body.enabled, db)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connector not found")
    return {"app": row.app, "enabled": row.enabled}


@router.delete("/{app}")
async def disconnect(app: str, current_user: CurrentUser, db: DB) -> dict:
    if not await connector_service.disconnect(current_user.org_id, app, db):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Connector not found")
    return {"ok": True}


class OAuthStartRequest(BaseModel):
    project_id: uuid.UUID | None = None
    # Shopify authorises per shop, so its consent URL needs the domain.
    shop_domain: str | None = None


@router.post("/{app}/oauth/start")
async def oauth_start(app: str, body: OAuthStartRequest, current_user: CurrentUser) -> dict:
    """The provider's consent URL for a one-click connection.

    The state is signed with the org and project baked in, so the callback
    cannot be pointed at someone else's organisation.
    """
    return connector_oauth.start(app, current_user.org_id, body.project_id,
                                 shop=(body.shop_domain or "").strip())


@router.get("/{app}/oauth/callback")
async def oauth_callback(app: str, request: Request, db: DB):
    """Where the provider sends the user back.

    No CurrentUser here -- the browser arrives from the provider without our
    auth header, which is exactly why the state is signed: it is the only thing
    identifying the organisation, so it is verified before anything is written.
    """
    params = dict(request.query_params)
    front = settings.FRONTEND_URL.rstrip("/")

    def fail(reason: str):
        return RedirectResponse(f"{front}/integrations?connector_error={reason}")

    if params.get("error"):
        # The user pressed Cancel. Not an error worth a scary screen.
        return RedirectResponse(f"{front}/integrations?connector=cancelled")

    code = params.get("code")
    claims = connector_oauth.read_state(params.get("state", ""))
    if not code or claims is None:
        return fail("invalid_state")

    result = await connector_oauth.exchange(app, code, shop=params.get("shop", ""))
    if not result.get("ok"):
        return fail(result.get("error", "exchange_failed"))

    try:
        await connector_service.save_oauth_token(
            uuid.UUID(claims["o"]), app, result["access_token"], db,
            label=result.get("workspace"))
    except Exception:  # noqa: BLE001
        logger.exception("could not store the %s connector", app)
        return fail("save_failed")

    project = claims.get("p")
    dest = f"{front}/{project}/integrations" if project else f"{front}/integrations"
    return RedirectResponse(f"{dest}?connector={app}")
