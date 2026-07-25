"""Decide which pages a discovery run should fetch, from the homepage's links."""
from urllib.parse import urlparse, urldefrag

_PRIORITY = ["about", "product", "shop", "collection", "service",
             "pricing", "contact", "blog"]


def _score(path: str) -> int:
    low = path.lower()
    for i, kw in enumerate(_PRIORITY):
        if kw in low:
            return i
    return len(_PRIORITY)


def select_urls(home_url: str, home_page: dict, max_pages: int = 8) -> list[str]:
    base_host = urlparse(home_url).netloc.lower().removeprefix("www.")
    seen = {home_url.rstrip("/")}
    candidates: list[str] = []
    for link in home_page.get("internal_links") or []:
        href = urldefrag((link.get("href") or "")).url.rstrip("/")
        if not href:
            continue
        host = urlparse(href).netloc.lower().removeprefix("www.")
        if host and host != base_host:
            continue
        if href in seen:
            continue
        seen.add(href)
        candidates.append(href)
    candidates.sort(key=lambda u: _score(urlparse(u).path))
    return [home_url] + candidates[: max(0, max_pages - 1)]
