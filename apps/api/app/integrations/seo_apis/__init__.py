from app.core.config import settings
from app.integrations.seo_apis.mock_provider import MockSEOProvider
from app.integrations.seo_apis.dataforseo import DataForSEOProvider


def get_seo_provider():
    """Returns real provider if credentials exist, else mock."""
    if settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD:
        return DataForSEOProvider(settings.DATAFORSEO_LOGIN, settings.DATAFORSEO_PASSWORD)
    return MockSEOProvider()


async def get_seo_provider_for_org(org_id, db) -> DataForSEOProvider | None:
    """Platform DataForSEO account/env by default; a tenant key is used only when
    the org has byok_enabled. Returns None when nothing is configured."""
    from app.services.providers import registry
    return await registry.resolve_seo_provider(org_id, db)
