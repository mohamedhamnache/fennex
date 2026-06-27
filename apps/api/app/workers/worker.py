# apps/api/app/workers/worker.py
from arq.connections import RedisSettings
from arq.cron import cron

from app.core.config import settings
from app.workers.tasks.analytics_tasks import seed_analytics_history, sync_analytics_data
from app.workers.tasks.audit_tasks import run_seo_audit
from app.workers.tasks.backlink_tasks import sync_backlink_profile, verify_exchange_link, weekly_backlink_discovery
from app.workers.tasks.crawl_tasks import crawl_website
from app.workers.tasks.keyword_tasks import run_keyword_research


async def startup(ctx):
    pass


async def shutdown(ctx):
    pass


async def _noop(ctx):
    pass


class WorkerSettings:
    functions = [
        _noop,
        crawl_website,
        run_seo_audit,
        run_keyword_research,
        seed_analytics_history,
        sync_analytics_data,
        sync_backlink_profile,
        verify_exchange_link,
        weekly_backlink_discovery,
    ]
    cron_jobs = [
        cron(sync_analytics_data, hour=6, minute=0, run_at_startup=False),
        cron(weekly_backlink_discovery, weekday=0, hour=7, minute=0, run_at_startup=False),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 10
    job_timeout = 600
