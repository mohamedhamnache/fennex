"""Competitor analysis — crawl a competitor page and compare it against the
project's own real GSC data, with AI-generated content-gap insights."""
import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.llm_service import call_llm, get_org_llm_keys, project_locale
from app.services.analytics_service import get_market_insights, get_top_queries

_PROVIDERS = [
    ("anthropic", "claude-opus-4-8"),
    ("openai", "gpt-4o"),
]

from app.agents.registry import agent_persona as _agent_persona

_SYSTEM = _agent_persona("sable") + (
    "You are given a crawl of a "
    "COMPETITOR page and the user's OWN top search queries and topic clusters (real Google "
    "Search Console data). In under ~170 words: (1) note what the competitor page does well "
    "(depth, structure, schema, meta), (2) identify concrete content gaps or angles the user "
    "is missing relative to their own demand, and (3) finish with 'Recommended actions:' listing "
    "2-4 specific things to create or improve in Fennex (write/refresh an article on a topic, "
    "add schema, expand a thin page, target a query). Cite specifics. No fluff, no markdown headings."
)


async def _crawl(url: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{settings.CRAWLER_SERVICE_URL}/crawl", json={"url": url})
        resp.raise_for_status()
        return resp.json()


def _scorecard(page: dict) -> dict:
    """Heuristic SEO signals + a 0-100 score from the crawled page."""
    title = page.get("title") or ""
    meta = page.get("meta_description") or ""
    wc = page.get("word_count") or 0
    h1 = page.get("h1") or []
    h2 = page.get("h2") or []
    schema = page.get("schema_types") or []
    imgs_no_alt = page.get("images_without_alt") or 0
    internal = len(page.get("internal_links") or [])

    checks = {
        "title_ok": 15 <= len(title) <= 65,
        "meta_ok": 50 <= len(meta) <= 165,
        "single_h1": len(h1) == 1,
        "has_h2": len(h2) >= 2,
        "depth_ok": wc >= 600,
        "has_schema": len(schema) > 0,
        "alt_ok": imgs_no_alt == 0,
        "internal_links_ok": internal >= 3,
        "canonical_ok": bool(page.get("canonical_url")),
        "viewport_ok": bool(page.get("has_viewport_meta")),
    }
    score = round(sum(1 for v in checks.values() if v) / len(checks) * 100)
    return {
        "score": score,
        "title": title,
        "title_length": len(title),
        "meta_description": meta,
        "meta_length": len(meta),
        "word_count": wc,
        "h1_count": len(h1),
        "h2_count": len(h2),
        "schema_types": schema,
        "images_without_alt": imgs_no_alt,
        "internal_links": internal,
        "canonical": page.get("canonical_url"),
        "checks": checks,
    }


async def scan_scorecard(url: str) -> dict:
    """Crawl a URL and return its scorecard only (no LLM insights). Raises on failure."""
    page = await _crawl(url)
    if page.get("error") or page.get("status_code", 0) >= 400:
        raise RuntimeError(page.get("error") or f"HTTP {page.get('status_code')}")
    return _scorecard(page)


async def analyze(project_id: uuid.UUID, org_id: uuid.UUID, url: str, db: AsyncSession) -> dict:
    try:
        page = await _crawl(url)
    except Exception as e:
        return {"ok": False, "error": f"Could not crawl that URL: {str(e)[:160]}"}

    if page.get("error") or page.get("status_code", 0) >= 400:
        return {"ok": False, "error": page.get("error") or f"HTTP {page.get('status_code')}"}

    card = _scorecard(page)

    # AI content-gap insights grounded in the user's own demand
    insights = ""
    keys = await get_org_llm_keys(org_id, db)
    if keys:
        queries = await get_top_queries(project_id, org_id, db)
        market = await get_market_insights(project_id, org_id, db)
        own = "TOP QUERIES: " + ", ".join(f"{q.query} (pos {q.avg_position:.0f})" for q in queries[:12])
        own += "\nTOPICS: " + ", ".join(f"{c.topic}({c.clicks})" for c in market.clusters[:10])
        comp = (
            f"COMPETITOR {url}\n"
            f"Title: {card['title']}\nMeta: {card['meta_description']}\n"
            f"Words: {card['word_count']}, H1: {card['h1_count']}, H2: {card['h2_count']}, "
            f"Schema: {', '.join(card['schema_types']) or 'none'}, Internal links: {card['internal_links']}\n"
            f"H2 outline: {', '.join((page.get('h2') or [])[:12])}"
        )
        user_prompt = f"OWN DATA:\n{own}\n\n{comp}"
        for provider, model in _PROVIDERS:
            if provider in keys:
                try:
                    insights = (await call_llm(provider, model, keys[provider], _SYSTEM, user_prompt, locale=await project_locale(project_id, db))).strip()
                    break
                except Exception:
                    continue

    return {
        "ok": True,
        "url": page.get("url", url),
        "scorecard": card,
        "outline": (page.get("h2") or [])[:15],
        "insights": insights,
    }
