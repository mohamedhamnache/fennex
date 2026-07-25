"""Tests for SERP-based competitor discovery."""
import pytest

from app.services.discovery import competitors as comp


class _FakeProvider:
    def __init__(self, serps):
        self._serps = serps  # keyword -> list[organic items]
        self.batch_calls = 0

    async def serp(self, keyword, language_code="en", location_code=2840, depth=100):
        return self._serps.get(keyword, [])

    async def serp_batch(self, keywords, language_code="en", location_code=2840, depth=100):
        # Discovery must use a single batched request, not one call per keyword.
        self.batch_calls += 1
        return {kw: self._serps.get(kw, []) for kw in keywords}


def _item(rank, domain):
    return {"type": "organic", "rank_absolute": rank, "domain": domain,
            "url": f"https://{domain}/x", "title": domain}


@pytest.fixture
def result():
    return {
        "business": {"name": "Acme", "language": "fr", "country": "FR", "industry": "recettes"},
        "seo": {"suggested_keywords": ["recettes faciles", "cuisine maison"]},
        "competitors": [{"name": "guessed", "url": "https://guessed.test"}],
    }


async def test_returns_empty_without_provider(result, monkeypatch):
    async def no_provider(*a, **k):
        return None
    monkeypatch.setattr(comp, "get_seo_provider_for_org", no_provider)
    out = await comp.discover_competitors(result, "org", "db", own_url="https://acme.test")
    assert out == []


async def test_ranks_by_keyword_overlap_and_filters_noise(result, monkeypatch):
    serps = {
        "recettes faciles": [
            _item(1, "acme.test"),          # own domain -> excluded
            _item(2, "www.rival-a.com"),    # real competitor (both keywords)
            _item(3, "youtube.com"),        # platform -> excluded
            _item(4, "rival-b.fr"),         # competitor (one keyword)
        ],
        "cuisine maison": [
            _item(1, "rival-a.com"),        # competitor again -> overlap 2
            _item(2, "pinterest.com"),      # platform -> excluded
            _item(3, "marmiton.org"),       # recipe aggregator -> excluded
            _item(5, "rival-c.com"),        # competitor (one keyword)
        ],
    }
    fake = _FakeProvider(serps)
    async def provider(*a, **k):
        return fake
    monkeypatch.setattr(comp, "get_seo_provider_for_org", provider)

    out = await comp.discover_competitors(result, "org", "db", own_url="https://www.acme.test")
    names = [c["name"] for c in out]

    # Cost control: all keywords fetched in ONE batched request.
    assert fake.batch_calls == 1

    assert "acme.test" not in names          # own domain excluded
    assert "youtube.com" not in names         # platform excluded
    assert "pinterest.com" not in names
    assert "marmiton.org" not in names        # aggregator excluded
    assert names[0] == "rival-a.com"          # ranks for BOTH keywords -> first
    assert "rival-b.fr" in names and "rival-c.com" in names
    assert out[0]["url"] == "https://rival-a.com"
    assert "2 seed keywords" in out[0]["note"]
