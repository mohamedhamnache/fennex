import httpx

from app.core.database import async_session_factory
from app.models.crawl import CrawlJob, CrawledPage, CrawlStatus
from app.core.config import settings


async def crawl_website(ctx, job_id: str, url: str):
    """ARQ task: crawl a single URL via the crawler microservice."""
    async with async_session_factory() as session:
        import uuid as _uuid
        job = await session.get(CrawlJob, _uuid.UUID(job_id))
        if job is None:
            return
        job.status = CrawlStatus.running
        await session.commit()
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(
                    f"{settings.CRAWLER_URL}/crawl",
                    json={"url": url},
                )
                data = resp.json()
            page = CrawledPage(
                crawl_job_id=job.id,
                url=data.get("url", url),
                status_code=data.get("status_code"),
                signals=data,
                seo_score=_score_page(data),
            )
            session.add(page)
            job.pages_crawled = 1
            job.status = CrawlStatus.completed
            await session.commit()
        except Exception as e:
            job.status = CrawlStatus.failed
            job.error = str(e)
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
