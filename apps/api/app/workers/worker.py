from arq.connections import RedisSettings

from app.core.config import settings
from app.workers.tasks.crawl_tasks import crawl_website
from app.workers.tasks.audit_tasks import run_seo_audit
from app.workers.tasks.keyword_tasks import run_keyword_research


async def startup(ctx):
    pass


async def shutdown(ctx):
    pass


async def _noop(ctx):
    """Placeholder — ARQ requires at least one registered function."""
    pass


class WorkerSettings:
    functions = [_noop, crawl_website, run_seo_audit, run_keyword_research]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 10
    job_timeout = 600  # 10 minutes default
