"""Competitor analysis — crawl a competitor page and compare it against the
project's own real GSC data, with AI-generated content-gap insights."""
import uuid

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.agents.skills import sable as sable_skills
from app.services.agents.standalone import run_standalone


def _render_insights(content: dict) -> str:
    gaps = [str(g).strip() for g in (content.get("gaps") or []) if str(g).strip()]
    prose = str(content.get("insights", "")).strip()
    parts = []
    if prose:
        parts.append(prose)
    if gaps:
        parts.append("Gaps to strike first:\n" + "\n".join(f"- {g}" for g in gaps))
    return "\n\n".join(parts)


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

    # AI content-gap insights via the Sable competitor-scan skill (grounding lives in its tools)
    insights = ""
    result = await run_standalone(sable_skills.COMPETITOR_SCAN, project_id, org_id,
                                  f"Scan competitor {url} and find the gaps to beat them.", db,
                                  inputs={"competitor_url": url})
    if result.ok and isinstance(result.content, dict):
        insights = _render_insights(result.content)

    return {
        "ok": True,
        "url": page.get("url", url),
        "scorecard": card,
        "outline": (page.get("h2") or [])[:15],
        "insights": insights,
    }
