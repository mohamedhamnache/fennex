"""Service for managing API keys with encrypted storage."""
import base64
import re
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decrypt_value, encrypt_value
from app.models.api_key import APIKey

# "dataforseo" is a data provider rather than an LLM, but it is stored the same
# way (encrypted, org-scoped) and was omitted here -- so every attempt to
# connect it was rejected as an invalid provider.
VALID_PROVIDERS = {"openai", "anthropic", "google", "dataforseo"}


def normalise_dataforseo(value: str) -> str:
    """Accept any of the forms DataForSEO's dashboard shows.

    The dashboard displays the API password AND a ready-made base64
    Authorization value, and it is not obvious which to paste. Our client uses
    HTTP Basic auth, which base64-encodes the credentials itself -- so pasting
    the encoded string gets it encoded twice and every request 401s.

    Accepted, all normalised to a plain `login:password`:
      login:password              used as-is
      login:<base64 of l:p>       the password field holds the encoded pair
      <base64 of login:password>  the whole encoded pair pasted alone
    """
    raw = (value or "").strip()
    if not raw:
        return raw

    def _decoded_pair(candidate: str) -> Optional[tuple[str, str]]:
        stripped = candidate.strip()
        # A real password rarely looks like base64 of something containing ":".
        if len(stripped) < 8 or not re.fullmatch(r"[A-Za-z0-9+/=]+", stripped):
            return None
        try:
            text = base64.b64decode(stripped, validate=True).decode("utf-8")
        except Exception:
            return None
        login, sep, password = text.partition(":")
        if sep and login and password:
            return login, password
        return None

    pair = _decoded_pair(raw)
    if pair:
        return f"{pair[0]}:{pair[1]}"

    login, sep, password = raw.partition(":")
    if sep and password:
        inner = _decoded_pair(password)
        if inner:
            # The encoded pair was pasted into the password field.
            return f"{inner[0]}:{inner[1]}"
    return raw


def _mask(value: str) -> str:
    """Return last-4 chars masked as sk-...XXXX.

    A `login:password` credential is masked on the password half only, so the
    account remains identifiable in the UI.
    """
    if ":" in value:
        login, _, secret = value.partition(":")
        tail = secret[-4:] if len(secret) >= 4 else secret
        return f"{login}:...{tail}"
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

    if provider == "dataforseo":
        value = normalise_dataforseo(value)

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
