from app.core.config import settings
from app.integrations.seo_apis.mock_provider import MockSEOProvider
from app.integrations.seo_apis.dataforseo import DataForSEOProvider


def get_seo_provider():
    """Returns real provider if credentials exist, else mock."""
    if settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD:
        return DataForSEOProvider(settings.DATAFORSEO_LOGIN, settings.DATAFORSEO_PASSWORD)
    return MockSEOProvider()


async def get_seo_provider_for_org(org_id, db) -> DataForSEOProvider | None:
    """Org-scoped provider: the org's DataForSEO key wins, env is a dev fallback,
    otherwise None (callers show a connect state - never the mock)."""
    from sqlalchemy import select
    from app.core.security import decrypt_value
    from app.models.api_key import APIKey

    row = (await db.execute(select(APIKey).where(
        APIKey.org_id == org_id, APIKey.provider == "dataforseo",
    ))).scalars().first()
    if row is not None:
        value = decrypt_value(row.encrypted_value)
        login, _, password = value.partition(":")
        if login and password:
            return DataForSEOProvider(login, password)
    if settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD:
        return DataForSEOProvider(settings.DATAFORSEO_LOGIN, settings.DATAFORSEO_PASSWORD)
    return None
