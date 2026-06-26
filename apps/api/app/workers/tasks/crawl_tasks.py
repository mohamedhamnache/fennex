import uuid
from collections import deque
from urllib.parse import urlparse

import httpx

from app.core.database import async_session_factory
from app.models.crawl import CrawlJob, CrawledPage, CrawlStatus
from app.core.config import settings

MAX_PAGES = 50  # cap per crawl job


async def crawl_website(ctx, job_id: str, url: str):
    """ARQ task: BFS-crawl a site up to MAX_PAGES via the crawler microservice."""
    async with async_session_factory() as session:
        job = await session.get(CrawlJob, uuid.UUID(job_id))
        if job is None:
            return
        job.status = CrawlStatus.running
        job.pages_total = MAX_PAGES  # upper bound shown in UI
        await session.commit()

    base_netloc = urlparse(url).netloc
    queue: deque[str] = deque([url])
    visited: set[str] = set()
    pages_crawled = 0

    async with httpx.AsyncClient(timeout=30.0) as client:
        while queue and pages_crawled < MAX_PAGES:
            current_url = queue.popleft()
            if current_url in visited:
                continue
            visited.add(current_url)

            try:
                resp = await client.post(
                    f"{settings.CRAWLER_SERVICE_URL}/crawl",
                    json={"url": current_url},
                )
                data = resp.json()
            except Exception:
                continue  # skip unreachable pages, keep crawling

            async with async_session_factory() as session:
                page = CrawledPage(
                    crawl_job_id=uuid.UUID(job_id),
                    url=data.get("url", current_url),
                    status_code=data.get("status_code"),
                    signals=data,
                    seo_score=_score_page(data),
                )
                session.add(page)
                pages_crawled += 1

                # Update live progress
                job_row = await session.get(CrawlJob, uuid.UUID(job_id))
                if job_row:
                    job_row.pages_crawled = pages_crawled
                await session.commit()

            # Enqueue internal links on the same domain
            for link in data.get("internal_links", []):
                href = link.get("href", "")
                if href and urlparse(href).netloc == base_netloc and href not in visited:
                    queue.append(href)

    async with async_session_factory() as session:
        job_row = await session.get(CrawlJob, uuid.UUID(job_id))
        if job_row:
            job_row.pages_crawled = pages_crawled
            job_row.pages_total = pages_crawled
            job_row.status = CrawlStatus.completed if pages_crawled > 0 else CrawlStatus.failed
            if pages_crawled == 0:
                job_row.error = "No pages could be crawled"
            await session.commit()


def _score_page(signals: dict) -> float:
    """Simple heuristic SEO score 0-100 based on crawl signals."""
    score = 100.0
    if not signals.get("title"):
        score -= 15
    if not signals.get("meta_description"):
        score -= 10
    if not signals.get("h1"):
        score -= 10
    if not signals.get("canonical_url"):
        score -= 5
    if not signals.get("has_viewport_meta"):
        score -= 5
    images_without_alt = signals.get("images_without_alt", 0)
    if images_without_alt > 0:
        score -= min(10, images_without_alt * 2)
    return max(0.0, score)
