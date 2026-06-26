import json
import time
from urllib.parse import urlparse, urljoin

import httpx
from bs4 import BeautifulSoup

USER_AGENT = "Fennex-Crawler/1.0 (+https://fennex.ai)"


async def crawl(url: str) -> dict:
    """Crawl a URL and extract SEO signals."""
    result = {
        "url": url,
        "status_code": 0,
        "crawl_duration_ms": 0,
        "title": None,
        "meta_description": None,
        "meta_robots": None,
        "canonical_url": None,
        "h1": [],
        "h2": [],
        "word_count": 0,
        "internal_links": [],
        "external_links": [],
        "images_without_alt": 0,
        "schema_types": [],
        "og_title": None,
        "og_description": None,
        "og_image": None,
        "has_viewport_meta": False,
        "error": None,
    }

    start = time.monotonic()
    try:
        async with httpx.AsyncClient(
            follow_redirects=True,
            timeout=10.0,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            response = await client.get(url)

        elapsed_ms = int((time.monotonic() - start) * 1000)
        result["crawl_duration_ms"] = elapsed_ms
        result["url"] = str(response.url)
        result["status_code"] = response.status_code

        if response.status_code != 200:
            result["error"] = f"HTTP {response.status_code}"
            return result

        html = response.text
        soup = BeautifulSoup(html, "lxml")
        base_netloc = urlparse(result["url"]).netloc

        # Title
        title_tag = soup.find("title")
        if title_tag:
            result["title"] = title_tag.get_text(strip=True) or None

        # Meta tags
        for meta in soup.find_all("meta"):
            name = (meta.get("name") or "").lower()
            prop = (meta.get("property") or "").lower()
            content = meta.get("content", "")

            if name == "description":
                result["meta_description"] = content or None
            elif name == "robots":
                result["meta_robots"] = content or None
            elif name == "viewport":
                result["has_viewport_meta"] = True
            elif prop == "og:title":
                result["og_title"] = content or None
            elif prop == "og:description":
                result["og_description"] = content or None
            elif prop == "og:image":
                result["og_image"] = content or None

        # Canonical
        canonical = soup.find("link", rel=lambda r: r and "canonical" in r)
        if canonical:
            result["canonical_url"] = canonical.get("href") or None

        # H1 tags
        result["h1"] = [tag.get_text(strip=True) for tag in soup.find_all("h1") if tag.get_text(strip=True)]

        # H2 tags (max 20)
        result["h2"] = [tag.get_text(strip=True) for tag in soup.find_all("h2") if tag.get_text(strip=True)][:20]

        # Word count (body text)
        body = soup.find("body")
        if body:
            text = body.get_text(separator=" ")
            result["word_count"] = len(text.split())

        # Links
        internal_links = []
        external_links = []
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if not href or href.startswith("#") or href.startswith("mailto:") or href.startswith("javascript:"):
                continue
            absolute_href = urljoin(result["url"], href)
            parsed = urlparse(absolute_href)
            if parsed.scheme not in ("http", "https"):
                continue
            link_text = a.get_text(strip=True)
            link_entry = {"href": absolute_href, "text": link_text}
            if parsed.netloc == base_netloc:
                internal_links.append(link_entry)
            else:
                external_links.append(link_entry)

        result["internal_links"] = internal_links[:100]
        result["external_links"] = external_links[:50]

        # Images without alt
        result["images_without_alt"] = sum(
            1 for img in soup.find_all("img") if not img.get("alt")
        )

        # JSON-LD schema types
        schema_types = []
        for script in soup.find_all("script", type="application/ld+json"):
            try:
                data = json.loads(script.string or "")
                if isinstance(data, list):
                    for item in data:
                        if isinstance(item, dict) and "@type" in item:
                            t = item["@type"]
                            if isinstance(t, list):
                                schema_types.extend(t)
                            else:
                                schema_types.append(t)
                elif isinstance(data, dict):
                    if "@type" in data:
                        t = data["@type"]
                        if isinstance(t, list):
                            schema_types.extend(t)
                        else:
                            schema_types.append(t)
            except (json.JSONDecodeError, TypeError):
                pass
        result["schema_types"] = schema_types

    except httpx.TimeoutException as exc:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        result["crawl_duration_ms"] = elapsed_ms
        result["error"] = f"Timeout: {exc}"
    except httpx.RequestError as exc:
        elapsed_ms = int((time.monotonic() - start) * 1000)
        result["crawl_duration_ms"] = elapsed_ms
        result["error"] = f"Request error: {exc}"

    return result
