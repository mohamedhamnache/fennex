"""Service for managing API keys with encrypted storage."""
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decrypt_value, encrypt_value
from app.models.api_key import APIKey

VALID_PROVIDERS = {"openai", "anthropic", "google"}


def _mask(value: str) -> str:
    """Return last-4 chars masked as sk-...XXXX."""
    tail = value[-4:] if len(value) >= 4 else value
    return f"sk-...{tail}"


async def list_keys(org_id: uuid.UUID, db: AsyncSession) -> list[dict]:
    """List all API keys for an organization."""
    result = await db.execute(
        select(APIKey).where(APIKey.org_id == org_id).order_by(APIKey.created_at)
    )
    keys = result.scalars().all()
    return [
        {
            "id": str(k.id),
            "provider": k.provider,
            "masked_value": _mask(decrypt_value(k.encrypted_value)),
            "created_at": k.created_at.isoformat() if k.created_at else None,
        }
        for k in keys
    ]


async def create_key(org_id: uuid.UUID, provider: str, value: str, db: AsyncSession) -> dict:
    """Create a new API key for an organization."""
    if provider not in VALID_PROVIDERS:
        raise ValueError(f"Invalid provider. Must be one of: {', '.join(sorted(VALID_PROVIDERS))}")

    key = APIKey(
        org_id=org_id,
        provider=provider,
        encrypted_value=encrypt_value(value),
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    return {
        "id": str(key.id),
        "provider": key.provider,
        "masked_value": _mask(value),
        "created_at": key.created_at.isoformat() if key.created_at else None,
    }


async def delete_key(key_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> bool:
    """Delete an API key for an organization."""
    result = await db.execute(
        select(APIKey).where(APIKey.id == key_id, APIKey.org_id == org_id)
    )
    key = result.scalar_one_or_none()
    if not key:
        return False
    await db.delete(key)
    await db.commit()
    return True
