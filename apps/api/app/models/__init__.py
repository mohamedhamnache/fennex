# Import all models so Alembic can discover them
from app.models.base import TimestampMixin
from app.models.organization import Organization
from app.models.user import User
from app.models.project import Project
from app.models.crawl import CrawlJob, CrawledPage, SEOAudit  # noqa: F401
