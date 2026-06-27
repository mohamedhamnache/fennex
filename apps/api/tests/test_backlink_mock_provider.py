import pytest
from app.integrations.seo_apis.mock_provider import MockSEOProvider


@pytest.fixture
def provider():
    return MockSEOProvider()


@pytest.mark.asyncio
async def test_get_backlink_profile(provider):
    result = await provider.get_backlink_profile("example.com")
    assert "domain_authority" in result
    assert "total_backlinks" in result
    assert isinstance(result["total_backlinks"], int)


@pytest.mark.asyncio
async def test_get_backlinks_returns_20(provider):
    result = await provider.get_backlinks("example.com")
    assert len(result) == 20
    assert "source_url" in result[0]
    assert "link_type" in result[0]


@pytest.mark.asyncio
async def test_get_backlink_opportunities_returns_10(provider):
    result = await provider.get_backlink_opportunities("example.com")
    assert len(result) == 10
    assert "linking_to_competitor" in result[0]
