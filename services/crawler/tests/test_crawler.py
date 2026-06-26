import pytest
import respx
import httpx
from fastapi.testclient import TestClient

from app.main import app

SAMPLE_HTML = """<!DOCTYPE html>
<html>
<head>
  <title>Test Page</title>
  <meta name="description" content="A test page description">
  <meta name="robots" content="index, follow">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://example.com/">
  <meta property="og:title" content="OG Test Title">
  <meta property="og:description" content="OG description">
  <meta property="og:image" content="https://example.com/image.jpg">
  <script type="application/ld+json">{"@type": "WebPage", "name": "Test"}</script>
</head>
<body>
  <h1>Main Heading</h1>
  <h1>Second H1</h1>
  <h2>Section One</h2>
  <h2>Section Two</h2>
  <p>Hello world this is some content for word count testing.</p>
  <a href="/internal-page">Internal Link</a>
  <a href="https://external.com/page">External Link</a>
  <img src="image1.jpg" alt="has alt">
  <img src="image2.jpg">
</body>
</html>"""

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@respx.mock
def test_crawl_basic():
    respx.get("https://example.com/").mock(
        return_value=httpx.Response(200, text=SAMPLE_HTML, headers={"content-type": "text/html"})
    )

    response = client.post("/crawl", json={"url": "https://example.com/"})
    assert response.status_code == 200
    data = response.json()

    assert data["url"] == "https://example.com/"
    assert data["status_code"] == 200
    assert data["error"] is None
    assert data["title"] == "Test Page"
    assert data["meta_description"] == "A test page description"
    assert data["meta_robots"] == "index, follow"
    assert data["canonical_url"] == "https://example.com/"
    assert data["h1"] == ["Main Heading", "Second H1"]
    assert data["h2"] == ["Section One", "Section Two"]
    assert data["has_viewport_meta"] is True
    assert data["og_title"] == "OG Test Title"
    assert data["og_description"] == "OG description"
    assert data["og_image"] == "https://example.com/image.jpg"
    assert data["schema_types"] == ["WebPage"]
    assert data["images_without_alt"] == 1
    assert data["word_count"] > 0

    # Internal link: /internal-page is on example.com
    assert any(link["href"] == "https://example.com/internal-page" for link in data["internal_links"])
    # External link
    assert any(link["href"] == "https://external.com/page" for link in data["external_links"])


@respx.mock
def test_crawl_non_200():
    respx.get("https://example.com/notfound").mock(
        return_value=httpx.Response(404, text="Not Found")
    )

    response = client.post("/crawl", json={"url": "https://example.com/notfound"})
    assert response.status_code == 200
    data = response.json()

    assert data["status_code"] == 404
    assert data["error"] == "HTTP 404"


@respx.mock
def test_crawl_timeout():
    respx.get("https://example.com/slow").mock(side_effect=httpx.TimeoutException("timed out"))

    response = client.post("/crawl", json={"url": "https://example.com/slow"})
    assert response.status_code == 200
    data = response.json()

    assert data["status_code"] == 0
    assert data["error"] is not None
    assert "Timeout" in data["error"]


@respx.mock
def test_crawl_request_error():
    respx.get("https://unreachable.example.com/").mock(
        side_effect=httpx.ConnectError("connection refused")
    )

    response = client.post("/crawl", json={"url": "https://unreachable.example.com/"})
    assert response.status_code == 200
    data = response.json()

    assert data["status_code"] == 0
    assert data["error"] is not None
    assert "Request error" in data["error"]


def test_crawl_invalid_url():
    response = client.post("/crawl", json={"url": "not-a-url"})
    assert response.status_code == 422
