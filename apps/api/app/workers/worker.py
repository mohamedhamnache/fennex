# apps/api/app/workers/worker.py
from arq.connections import RedisSettings
from arq.cron import cron

from app.core.config import settings
from app.workers.tasks.analytics_tasks import seed_analytics_history, sync_analytics_data
from app.workers.tasks.article_tasks import generate_article_task
from app.workers.tasks.audit_tasks import run_seo_audit
from app.workers.tasks.autopilot_tasks import run_autopilot_planner
from app.workers.tasks.backlink_tasks import sync_backlink_profile, verify_exchange_link, weekly_backlink_discovery
from app.workers.tasks.calendar_tasks import run_content_scheduler
from app.workers.tasks.campaign_tasks import run_campaign
from app.workers.tasks.crawl_tasks import crawl_website
from app.workers.tasks.digest_tasks import send_weekly_digests
from app.workers.tasks.keyword_tasks import run_keyword_research
from app.workers.tasks.monitoring_tasks import run_competitor_monitor, run_market_monitor
from app.workers.tasks.seo_tasks import run_rank_tracker


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
        generate_article_task,
        send_weekly_digests,
        run_content_scheduler,
        run_campaign,
        run_autopilot_planner,
        run_market_monitor,
        run_competitor_monitor,
        run_rank_tracker,
    ]
    cron_jobs = [
        cron(sync_analytics_data, hour=6, minute=0, run_at_startup=False),
        cron(weekly_backlink_discovery, weekday=0, hour=7, minute=0, run_at_startup=False),
        # Monday-morning persona digest, after the daily analytics sync
        cron(send_weekly_digests, weekday=0, hour=8, minute=0, run_at_startup=False),
        cron(run_content_scheduler, minute={0, 15, 30, 45}, run_at_startup=False),
        # Monday-morning autopilot planning, after the 06:00 analytics sync
        cron(run_autopilot_planner, weekday=0, hour=7, minute=30, run_at_startup=False),
        # The Pack keeps watch: Oasis market shifts Monday (before the 08:00 digest),
        # Sable competitor re-scans Tuesday.
        cron(run_market_monitor, weekday=0, hour=7, minute=0, run_at_startup=False),
        cron(run_competitor_monitor, weekday=1, hour=7, minute=0, run_at_startup=False),
        # Zerda's daily SERP rank tracker, ahead of the 06:00 analytics sync
        cron(run_rank_tracker, hour=5, minute=30, run_at_startup=False),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 10
    job_timeout = 600
