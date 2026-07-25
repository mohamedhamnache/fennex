"""Deterministic (no-LLM) extraction of structured signals from crawled HTML.

These are the fields an LLM cannot reliably return: exact hex colours, the
logo URL, social handles, JSON-LD products. Everything here degrades to empty
rather than raising."""
import copy
import json
import re
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup

_SOCIAL_HOSTS = {
    "instagram.com": "instagram", "facebook.com": "facebook", "x.com": "x",
    "twitter.com": "x", "linkedin.com": "linkedin", "youtube.com": "youtube",
    "pinterest.com": "pinterest", "tiktok.com": "tiktok",
}
_HEX_RE = re.compile(r"#[0-9a-fA-F]{6}\b")
_FONT_RE = re.compile(r"font-family\s*:\s*([^;{}]+)", re.I)
_CMS_HINTS = [("WordPress", "wordpress"), ("Shopify", "shopify"),
              ("Wix", "wix"), ("Squarespace", "squarespace"), ("Webflow", "webflow")]


def empty_result() -> dict:
    return {
        "business": {"name": None, "domain": None, "industry": None, "country": None,
                     "language": None, "timezone": None, "cms": None,
                     "contact": {"email": None, "phone": None}, "socials": {},
                     "navigation": [], "description": None},
        "brand": {"logo_url": None, "colors": [], "primary_font": None, "secondary_font": None,
                  "tone": None, "personality": [], "mission": None, "vision": None, "values": [],
                  "voice_prompt": None, "vocabulary": [], "avoid_words": [],
                  "cta_style": None, "reading_level": None, "emoji_policy": None},
        "products": [], "audience": [], "competitors": [],
        "seo": {"score": None, "title": None, "meta_description": None,
                "word_count": None, "issues": [], "suggested_keywords": []},
        "goals": [], "success_metrics": [],
    }


def _jsonld_blocks(soup) -> list[dict]:
    out = []
    for tag in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(tag.string or "")
        except Exception:
            continue
        out.extend(data if isinstance(data, list) else [data])
    return [b for b in out if isinstance(b, dict)]


def _clean_fonts(decl: str) -> str | None:
    first = decl.split(",")[0].strip().strip('"').strip("'")
    generic = {"sans-serif", "serif", "monospace", "system-ui", "inherit", "cursive"}
    return first if first and first.lower() not in generic else None


def extract_from_page(html: str, base_url: str) -> dict:
    r = empty_result()
    if not html:
        return r
    soup = BeautifulSoup(html, "html.parser")
    b, brand = r["business"], r["brand"]

    html_tag = soup.find("html")
    if html_tag and html_tag.get("lang"):
        b["language"] = html_tag["lang"].split("-")[0].strip() or None

    gen = soup.find("meta", attrs={"name": "generator"})
    haystack = ((gen.get("content") if gen else "") + " " + html[:4000]).lower()
    for label, needle in _CMS_HINTS:
        if needle in haystack:
            b["cms"] = label
            break

    for block in _jsonld_blocks(soup):
        t = block.get("@type", "")
        types = t if isinstance(t, list) else [t]
        if any(x in ("Organization", "LocalBusiness", "WebSite") for x in types):
            b["name"] = b["name"] or block.get("name")
            b["contact"]["email"] = b["contact"]["email"] or block.get("email")
            b["contact"]["phone"] = b["contact"]["phone"] or block.get("telephone")
        if "Product" in types:
            offers = block.get("offers") or {}
            price = offers.get("price") if isinstance(offers, dict) else None
            r["products"].append({
                "name": block.get("name"), "description": block.get("description"),
                "category": block.get("category"), "price": price,
                "benefits": [], "url": block.get("url"),
                "image_url": block.get("image") if isinstance(block.get("image"), str) else None,
            })

    if not b["name"]:
        og = soup.find("meta", property="og:site_name") or soup.find("meta", property="og:title")
        if og and og.get("content"):
            b["name"] = og["content"].strip()
        elif soup.title and soup.title.string:
            b["name"] = soup.title.string.split("|")[0].split("-")[0].strip()

    for a in soup.find_all("a", href=True):
        host = urlparse(a["href"]).netloc.lower().removeprefix("www.")
        for known, key in _SOCIAL_HOSTS.items():
            if host.endswith(known) and key not in b["socials"]:
                b["socials"][key] = a["href"] if a["href"].startswith("http") else urljoin(base_url, a["href"])

    nav = soup.find("nav")
    if nav:
        b["navigation"] = [a.get_text(strip=True) for a in nav.find_all("a") if a.get_text(strip=True)][:12]

    icon = soup.find("link", rel=lambda v: v and "icon" in v.lower())
    og_img = soup.find("meta", property="og:image")
    logo = (icon.get("href") if icon else None) or (og_img.get("content") if og_img else None)
    if logo:
        brand["logo_url"] = logo if logo.startswith("http") else urljoin(base_url, logo)

    colors = []
    meta_theme = soup.find("meta", attrs={"name": "theme-color"})
    if meta_theme and meta_theme.get("content", "").startswith("#"):
        colors.append(meta_theme["content"].upper())
    for m in _HEX_RE.findall(html):
        u = m.upper()
        if u not in colors:
            colors.append(u)
    brand["colors"] = colors[:6]

    fonts = []
    for decl in _FONT_RE.findall(html):
        f = _clean_fonts(decl)
        if f and f not in fonts:
            fonts.append(f)
    brand["primary_font"] = fonts[0] if fonts else None
    brand["secondary_font"] = fonts[1] if len(fonts) > 1 else None
    return r


def _merge_dict(base: dict, patch: dict) -> dict:
    for k, v in patch.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge_dict(base[k], v)
        elif isinstance(v, list):
            existing = base.get(k) or []
            seen = {json.dumps(x, sort_keys=True) for x in existing}
            for item in v:
                key = json.dumps(item, sort_keys=True)
                if key not in seen:
                    existing.append(item)
                    seen.add(key)
            base[k] = existing
        else:
            if v and not base.get(k):
                base[k] = v
    return base


def merge_result(base: dict, patch: dict) -> dict:
    return _merge_dict(copy.deepcopy(base), patch)
