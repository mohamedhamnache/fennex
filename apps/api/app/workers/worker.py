from arq.connections import RedisSettings

from app.core.config import settings


async def startup(ctx):
    pass


async def shutdown(ctx):
    pass


async def _noop(ctx):
    """Placeholder — ARQ requires at least one registered function."""
    pass


class WorkerSettings:
    functions = [_noop]  # Real tasks registered in Phase 2+
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    max_jobs = 10
    job_timeout = 600  # 10 minutes default
