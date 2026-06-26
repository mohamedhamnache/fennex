from app.core.config import settings
from app.integrations.seo_apis.mock_provider import MockSEOProvider
from app.integrations.seo_apis.dataforseo import DataForSEOProvider


def get_seo_provider():
    """Returns real provider if credentials exist, else mock."""
    if settings.DATAFORSEO_LOGIN and settings.DATAFORSEO_PASSWORD:
        return DataForSEOProvider(settings.DATAFORSEO_LOGIN, settings.DATAFORSEO_PASSWORD)
    return MockSEOProvider()
