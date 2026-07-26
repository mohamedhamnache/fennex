"""Runs a DiscoveryRun through its stages and writes progress + result.

Reuses the crawler microservice, the deterministic extractors, one LLM
synthesis call, and the existing SEO scorecard. Never raises out of the
pipeline: a failed stage degrades to a partial result."""
import logging
import uuid

import httpx

from app.core.config import settings
from app.core.database import async_session_factory
from app.models.discovery import DiscoveryRun
from app.services import competitor_service
from app.services.agents.tiers import resolve_model
from app.services.discovery import competitors, crawl_map, extractors, synthesis
from app.services.llm_service import get_org_llm_keys

logger = logging.getLogger(__name__)

MAX_PAGES = 8


async def _default_fetch(url: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{settings.CRAWLER_SERVICE_URL}/crawl", json={"url": url})
        return resp.json()


async def _org_model(org_id: uuid.UUID, db):
    """Return (provider, model, api_key) for the org's balanced 'heavy' tier."""
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return None, None, None
    provider, model = resolve_model("balanced", "heavy", list(keys))
    return provider, model, keys[provider]


async def _set(run_id: uuid.UUID, *, stage=None, progress=None, status=None,
               result=None, error=None):
    async with async_session_factory() as db:
        run = await db.get(DiscoveryRun, run_id)
        if run is None:
            return
        if stage is not None:
            run.stage = stage
        if progress is not None:
            run.progress = progress
        if status is not None:
            run.status = status
        if result is not None:
            run.result = result
        if error is not None:
            run.error = error
        await db.commit()


async def run_discovery_pipeline(run_id: uuid.UUID, fetch=None) -> None:
    fetch = fetch or _default_fetch
    # Built up incrementally so that whatever has been gathered by the time a
    # stage fails is still what gets persisted in the except branch below.
    result = extractors.empty_result()
    try:
        async with async_session_factory() as db:
            run = await db.get(DiscoveryRun, run_id)
            if run is None:
                return
            org_id, url, description = run.org_id, run.input_url, run.input_description
            provider, model, api_key = await _org_model(org_id, db)

        # No-website path: synthesise from the typed description alone.
        if not url:
            await _set(run_id, status="running", stage="Building profile", progress=40)
            result["business"]["description"] = description
            if api_key:
                async with async_session_factory() as mdb:
                    result = await synthesis.synthesise(
                        description or "", result, provider=provider, model=model,
                        api_key=api_key, locale="en",
                        meter={"db": mdb, "org_id": org_id, "project_id": None,
                              "feature": "discovery"})
            await _set(run_id, status="done", stage="Done", progress=100, result=result)
            return

        result["business"]["domain"] = url
        await _set(run_id, status="running", stage="Analyzing website", progress=8)
        home = await fetch(url)
        result = extractors.merge_result(result, extractors.extract_from_page(home.get("text_html") or "", url))
        # crawler returns cleaned text under "text"; extractors want raw HTML when present.
        # The homepage is the authoritative brand palette. Sub-pages merged below
        # would otherwise pile on widget/section colours, so keep the homepage's.
        home_colors = list(result["brand"]["colors"])

        await _set(run_id, stage="Reading pages", progress=25)
        page_urls = crawl_map.select_urls(url, home, MAX_PAGES)
        corpus = [home.get("text") or ""]
        for i, page_url in enumerate(page_urls[1:], start=1):
            try:
                page = await fetch(page_url)
            except Exception:
                continue
            result = extractors.merge_result(result, extractors.extract_from_page(page.get("text_html") or "", page_url))
            corpus.append(page.get("text") or "")
            await _set(run_id, stage="Reading pages", progress=min(45, 25 + i * 3))

        # Restore the homepage palette (if any) over the multi-page accumulation.
        if home_colors:
            result["brand"]["colors"] = home_colors

        await _set(run_id, stage="Understanding products", progress=55)
        text = "\n\n".join(t for t in corpus if t)[:16000]
        if api_key:
            # Answer in the site's own language (detected from <html lang>) so the
            # description, mission, audience, keywords etc. match the business's
            # language rather than defaulting to English.
            locale = (result.get("business", {}).get("language")) or "en"
            async with async_session_factory() as mdb:
                result = await synthesis.synthesise(
                    text, result, provider=provider, model=model, api_key=api_key,
                    locale=locale,
                    meter={"db": mdb, "org_id": org_id, "project_id": None,
                          "feature": "discovery"})

        await _set(run_id, stage="Finding competitors", progress=75)
        # Real competitors = sites that rank for the same seed keywords. When a
        # SERP provider is configured this is far more accurate than the LLM's
        # guesses, so it replaces them; otherwise we keep the synthesised list.
        try:
            async with async_session_factory() as db:
                real_competitors = await competitors.discover_competitors(
                    result, org_id, db, own_url=url)
            if real_competitors:
                result["competitors"] = real_competitors
        except Exception:
            logger.info("competitor discovery skipped for %s", url)

        await _set(run_id, stage="Analyzing SEO", progress=88)
        try:
            card = await competitor_service.scan_scorecard(url)
            result["seo"]["score"] = card.get("score")
            result["seo"]["title"] = card.get("title")
            result["seo"]["meta_description"] = card.get("meta_description")
            result["seo"]["word_count"] = card.get("word_count")
        except Exception:
            logger.info("SEO scorecard skipped for %s", url)

        await _set(run_id, status="done", stage="Done", progress=100, result=result)
    except Exception as exc:  # noqa: BLE001
        logger.exception("discovery pipeline error")
        try:
            await _set(run_id, status="done", stage="Done", progress=100,
                       result=result, error=str(exc)[:400])
        except Exception:
            # Best-effort: if even the terminal write fails (e.g. DB outage),
            # there is nothing further we can do without raising out of the
            # pipeline and leaving the row stuck mid-flight.
            logger.exception("discovery pipeline failed to write terminal error state")
