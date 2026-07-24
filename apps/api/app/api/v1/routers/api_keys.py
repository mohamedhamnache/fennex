import uuid

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.dependencies import DB, CurrentUser
from app.services.api_keys_service import create_key, delete_key, list_keys

router = APIRouter()


@router.post("/dataforseo/test")
async def test_dataforseo(current_user: CurrentUser, db: DB) -> dict:
    """Check the stored SEO credentials actually work.

    Connecting used to fail silently at the point of first use -- a keyword
    lookup would just return nothing. This makes a bad credential visible at
    the moment it is entered.
    """
    from app.integrations.seo_apis import get_seo_provider_for_org

    provider = await get_seo_provider_for_org(current_user.org_id, db)
    if provider is None:
        return {"ok": False, "error": "No SEO credentials are connected."}
    try:
        items = await provider.serp("seo", language_code="en", location_code=2840)
        return {"ok": True, "results": len(items or [])}
    except Exception as exc:   # noqa: BLE001
        return {"ok": False, "error": str(exc)[:300]}


class ApiKeyOut(BaseModel):
    id: str
    provider: str
    masked_value: str
    created_at: str | None


class ApiKeyCreate(BaseModel):
    provider: str
    value: str


@router.get("", response_model=list[ApiKeyOut])
async def get_api_keys(current_user: CurrentUser, db: DB):
    """List all API keys for the current user's organization."""
    return await list_keys(current_user.org_id, db)


@router.post("", response_model=ApiKeyOut, status_code=201)
async def add_api_key(body: ApiKeyCreate, current_user: CurrentUser, db: DB):
    """Create a new API key for the current user's organization."""
    try:
        return await create_key(current_user.org_id, body.provider, body.value, db)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/{key_id}", status_code=204)
async def remove_api_key(key_id: uuid.UUID, current_user: CurrentUser, db: DB):
    """Delete an API key from the current user's organization."""
    deleted = await delete_key(key_id, current_user.org_id, db)
    if not deleted:
        raise HTTPException(status_code=404, detail="Key not found")
