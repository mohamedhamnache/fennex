"""Supplier-neutral provider resolution. Platform credentials (provider_accounts,
then env bootstrap) are the default; a tenant key is used only when the org has
byok_enabled. LLM launch supplier is OpenAI; Anthropic/Google are fallbacks."""
import uuid

from sqlalchemy import select

from app.core.config import settings
from app.core.security import decrypt_value
from app.integrations.seo_apis.dataforseo import DataForSEOProvider
from app.models.api_key import APIKey
from app.models.organization import Organization
from app.models.provider_account import ProviderAccount

_ENV_LLM = {
    "openai": lambda: settings.OPENAI_API_KEY,
    "anthropic": lambda: settings.ANTHROPIC_API_KEY,
    "google": lambda: settings.GOOGLE_API_KEY,
}


async def platform_llm_keys(db) -> dict[str, str]:
    rows = (await db.execute(
        select(ProviderAccount).where(
            ProviderAccount.kind == "llm", ProviderAccount.is_active == True  # noqa: E712
        ).order_by(ProviderAccount.priority.asc())
    )).scalars().all()
    keys: dict[str, str] = {}
    for row in rows:
        if row.provider not in keys:  # lowest priority per provider wins
            keys[row.provider] = decrypt_value(row.encrypted_credentials)
    for provider, getter in _ENV_LLM.items():
        if provider not in keys and getter():
            keys[provider] = getter()
    return keys


async def _org(org_id: uuid.UUID, db) -> Organization | None:
    return (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()


async def get_llm_keys(org_id: uuid.UUID, db) -> dict[str, str]:
    from app.services.providers import catalog
    await catalog.refresh_if_stale(db)
    keys = await platform_llm_keys(db)
    org = await _org(org_id, db)
    if org is not None and org.byok_enabled:
        rows = (await db.execute(
            select(APIKey).where(APIKey.org_id == org_id)
        )).scalars().all()
        for k in rows:
            if k.provider in _ENV_LLM:  # only llm providers override llm keys
                keys[k.provider] = decrypt_value(k.encrypted_value)
    return keys


async def resolve_seo_provider(org_id: uuid.UUID, db) -> DataForSEOProvider | None:
    org = await _org(org_id, db)
    # BYOK: tenant DataForSEO key wins only when byok is on.
    if org is not None and org.byok_enabled:
        row = (await db.execute(select(APIKey).where(
            APIKey.org_id == org_id, APIKey.provider == "dataforseo"
        ))).scalars().first()
        if row is not None:
            login, _, password = decrypt_value(row.encrypted_value).partition(":")
            if login and password:
                return DataForSEOProvider(login, password)
    # Platform account first, then env bootstrap.
    acct = (await db.execute(select(ProviderAccount).where(
        ProviderAccount.kind == "seo", ProviderAccount.provider == "dataforseo",
        ProviderAccount.is_active == True,  # noqa: E712
    ).order_by(ProviderAccount.priority.asc()))).scalars().first()
    if acct is not None:
        login, _, password = decrypt_value(acct.encrypted_credentials).partition(":")
        if login and password:
            return DataForSEOProvider(login, password)
    if settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD:
        return DataForSEOProvider(settings.DATAFORSEO_LOGIN, settings.DATAFORSEO_PASSWORD)
    return None
