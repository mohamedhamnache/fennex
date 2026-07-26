"""High-accuracy competitor discovery from real SERP data.

The sites that rank for the same searches as the business are the ones actually
doing almost the same thing -- far more reliable than an LLM guessing plausible
names. We query the org's SERP provider for the discovered seed keywords, keep
domains that show up (especially across multiple keywords), and drop the
business's own site plus the marketplaces/social/info platforms that rank for
everything. Returns [] when no SERP provider is configured, so the caller can
fall back to the LLM-suggested competitors."""
import logging
from urllib.parse import urlparse

from app.integrations.seo_apis import get_seo_provider_for_org
from app.services.serp_service import COUNTRY_LOCATIONS

logger = logging.getLogger(__name__)

# DataForSEO cost controls. Each keyword is one billable SERP task and cost
# scales with depth, so keep both small: 3 keywords give enough ranking-overlap
# signal, and real competitors sit at the top of the page.
SERP_KEYWORDS = 3
SERP_DEPTH = 10

# Second-level names that rank for almost any query but are never a specific
# business's competitor.
_NON_COMPETITORS = {
    "amazon", "ebay", "etsy", "aliexpress", "walmart", "target", "wish", "temu",
    "cdiscount", "fnac", "rakuten", "leboncoin",
    "youtube", "wikipedia", "wikihow", "pinterest", "facebook", "instagram",
    "twitter", "x", "linkedin", "reddit", "tripadvisor", "yelp", "tumblr",
    "medium", "quora", "snapchat", "whatsapp", "tiktok", "fandom",
    "google", "bing", "yahoo", "apple", "microsoft", "booking", "airbnb",
    "wordpress", "shopify", "wixsite", "wix", "blogspot", "substack",
    "forbes", "businessinsider", "nytimes", "theguardian", "bbc", "cnn",
    "houzz", "angi", "thumbtack", "glassdoor", "indeed", "crunchbase",
    "marmiton", "cuisineaz", "750g", "allrecipes",  # recipe portals/aggregators
}


def _registrable(domain: str) -> str:
    d = (domain or "").lower().strip()
    if "://" in d:
        d = urlparse(d).netloc
    if d.startswith("www."):
        d = d[4:]
    return d


def _second_level(domain: str) -> str:
    parts = _registrable(domain).split(".")
    if len(parts) >= 2:
        return parts[-2]
    return parts[0] if parts and parts[0] else ""


def _location_code(country: str | None, language_code: str) -> int:
    c = (country or "").strip().upper()
    if c in COUNTRY_LOCATIONS:
        return COUNTRY_LOCATIONS[c]
    return 2250 if language_code == "fr" else 2840


async def discover_competitors(result: dict, org_id, db, *, own_url: str,
                               max_competitors: int = 6) -> list[dict]:
    provider = await get_seo_provider_for_org(org_id, db)
    if provider is None:
        return []

    business = result.get("business", {}) or {}
    seo = result.get("seo", {}) or {}
    # Cost control: 3 keywords is enough overlap signal, and we only need the top
    # of the page, so query a shallow SERP. See SERP_KEYWORDS / SERP_DEPTH.
    keywords = [k for k in (seo.get("suggested_keywords") or [])
                if isinstance(k, str) and k.strip()][:SERP_KEYWORDS]
    if not keywords:
        seed = business.get("industry") or business.get("name")
        keywords = [seed] if seed else []
    if not keywords:
        return []

    language_code = (business.get("language") or "en")[:2].lower()
    location_code = _location_code(business.get("country"), language_code)
    own = _second_level(own_url)

    # One batched request (all keywords) instead of one call per keyword.
    try:
        serps = await provider.serp_batch(
            keywords, language_code=language_code, location_code=location_code, depth=SERP_DEPTH)
    except Exception:
        logger.info("discovery SERP batch failed")
        return []

    from app.services.metering import meter as _m
    try:
        await _m.record_seo(db, org_id=org_id, project_id=None, unit="serp",
                            count=len(keywords), feature="discovery")
    except Exception:
        logger.info("seo metering skipped")

    counts: dict[str, int] = {}
    best_rank: dict[str, int] = {}
    for kw in keywords:
        items = serps.get(kw) or []
        seen_this_kw: set[str] = set()
        for item in items:
            if item.get("type") != "organic":
                continue
            dom = _registrable(item.get("domain") or "")
            if not dom or dom in seen_this_kw:
                continue
            sl = _second_level(dom)
            if not sl or sl == own or sl in _NON_COMPETITORS:
                continue
            seen_this_kw.add(dom)
            counts[dom] = counts.get(dom, 0) + 1
            rank = item.get("rank_absolute") or 100
            best_rank[dom] = min(best_rank.get(dom, 999), int(rank))

    if not counts:
        return []

    # Most on-topic first: appears for the most seed keywords, then best rank.
    ranked = sorted(counts, key=lambda d: (-counts[d], best_rank.get(d, 999)))
    out = []
    for dom in ranked[:max_competitors]:
        n = counts[dom]
        note = f"Ranks alongside you for {n} seed keyword{'s' if n != 1 else ''}"
        out.append({"name": dom, "url": f"https://{dom}", "note": note})
    return out
