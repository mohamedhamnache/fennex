from pathlib import Path
from app.services.discovery import extractors

HTML = (Path(__file__).parent / "fixtures" / "sample_page.html").read_text()


def test_empty_result_shape():
    r = extractors.empty_result()
    assert r["business"]["socials"] == {}
    assert r["brand"]["colors"] == []
    assert r["products"] == []


def test_extract_core_fields():
    p = extractors.extract_from_page(HTML, "https://acme.test")
    assert p["business"]["name"] == "Acme Cafe"
    assert p["business"]["language"] == "fr"
    assert p["business"]["cms"] == "WordPress"
    assert p["business"]["contact"]["email"] == "hi@acme.test"
    assert "instagram" in p["business"]["socials"]
    assert p["business"]["socials"]["linkedin"].startswith("https://")
    assert p["brand"]["logo_url"] == "https://acme.test/favicon.png"
    assert "#7C3AED" in p["brand"]["colors"]
    assert p["brand"]["primary_font"] == "Space Grotesk"
    assert any(prod["name"] == "House Blend" for prod in p["products"])


def test_merge_prefers_existing_truthy():
    base = extractors.empty_result()
    base["business"]["name"] = "Existing"
    merged = extractors.merge_result(base, {"business": {"name": "New"}})
    assert merged["business"]["name"] == "Existing"
    merged2 = extractors.merge_result(extractors.empty_result(), {"business": {"name": "New"}})
    assert merged2["business"]["name"] == "New"
