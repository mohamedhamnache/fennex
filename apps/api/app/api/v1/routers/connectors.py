"""Connecting tools to the AI employees."""

import logging

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from app.core.dependencies import CurrentUser, DB
from app.services import connector_service

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
