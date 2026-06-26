import uuid as _uuid

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.crawl import SEOAudit, AuditStatus, CrawledPage


async def run_seo_audit(ctx, audit_id: str):
    """ARQ task: compute SEO audit scores from crawled pages."""
    async with async_session_factory() as session:
        audit = await session.get(SEOAudit, _uuid.UUID(audit_id))
        if audit is None:
            return
        audit.status = AuditStatus.running
        await session.commit()
        try:
            issues = []
            pages_scores = []
            if audit.crawl_job_id:
                result = await session.execute(
                    select(CrawledPage).where(CrawledPage.crawl_job_id == audit.crawl_job_id)
                )
                pages = result.scalars().all()
                for page in pages:
                    if page.seo_score is not None:
                        pages_scores.append(page.seo_score)
                    signals = page.signals or {}
                    if not signals.get("title"):
                        issues.append({
                            "type": "missing_title",
                            "severity": "critical",
                            "url": page.url,
                            "message": "Page is missing a title tag",
                        })
                    if not signals.get("meta_description"):
                        issues.append({
                            "type": "missing_meta_description",
                            "severity": "warning",
                            "url": page.url,
                            "message": "Page is missing a meta description",
                        })
                    if not signals.get("h1"):
                        issues.append({
                            "type": "missing_h1",
                            "severity": "warning",
                            "url": page.url,
                            "message": "Page has no H1 tag",
                        })
                    if not signals.get("canonical_url"):
                        issues.append({
                            "type": "missing_canonical",
                            "severity": "info",
                            "url": page.url,
                            "message": "No canonical URL specified",
                        })

            overall = sum(pages_scores) / len(pages_scores) if pages_scores else 0.0
            audit.overall_score = round(overall, 1)
            audit.technical_score = round(overall * 0.9, 1)
            audit.content_score = round(min(overall * 1.1, 100.0), 1)
            audit.onpage_score = round(overall * 0.95, 1)
            audit.issues = issues
            audit.summary = {
                "pages_audited": len(pages_scores),
                "critical_issues": sum(1 for i in issues if i["severity"] == "critical"),
                "warnings": sum(1 for i in issues if i["severity"] == "warning"),
                "infos": sum(1 for i in issues if i["severity"] == "info"),
            }
            audit.status = AuditStatus.completed
            await session.commit()
        except Exception:
            audit.status = AuditStatus.failed
            await session.commit()
            raise
