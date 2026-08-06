"""The scheduled store sync.

Everything here guards a cron nobody watches. A scheduled job that silently
stops selecting anything looks identical to one with no work to do, so the
selection rules are asserted rather than trusted.
"""
import inspect

from app.workers import worker
from app.workers.tasks import store_tasks


class TestScheduling:
    def test_the_job_is_registered_with_the_worker(self):
        """A task in the module but absent from `functions` is never runnable,
        and nothing at import time complains."""
        assert store_tasks.sync_store_orders in worker.WorkerSettings.functions

    def test_it_is_actually_scheduled(self):
        # arq names a cron "cron:<fn>", so match on the coroutine itself.
        names = {c.coroutine.__name__ for c in worker.WorkerSettings.cron_jobs}
        assert "sync_store_orders" in names

    def test_it_runs_daily_not_weekly(self):
        """The rank tracker is weekly because every run bills SEO credits.
        Shopify's Orders API is free, so the same restraint here would only
        make the dashboard staler for no saving. `weekday=None` is what makes
        an arq cron daily -- the inverse of the bug that made rank tracking run
        7x more often than intended."""
        job = next(c for c in worker.WorkerSettings.cron_jobs
                   if c.coroutine.__name__ == "sync_store_orders")
        assert getattr(job, "weekday", None) is None

    def test_it_runs_before_the_morning_analytics_sync(self):
        """Orders must land before the 06:00 analytics job so the first
        dashboard of the day is current."""
        jobs = {c.coroutine.__name__: c for c in worker.WorkerSettings.cron_jobs}
        store = jobs["sync_store_orders"]
        analytics = jobs["sync_analytics_data"]
        assert (store.hour, store.minute) < (analytics.hour, analytics.minute)


class TestSelection:
    def test_only_active_connections_are_selected(self):
        """A disconnected store still has a row. Syncing it would fail on every
        run, forever, filling the log with an error nobody can act on."""
        src = inspect.getsource(store_tasks.sync_store_orders)
        assert "ShopifyConnection.is_active.is_(True)" in src

    def test_dormant_projects_are_skipped(self):
        src = inspect.getsource(store_tasks.sync_store_orders)
        assert "DORMANT_AFTER_DAYS" in src
        assert "UsageEvent.ts >= cutoff" in src

    def test_the_dormancy_window_matches_the_rank_tracker(self):
        """Two jobs disagreeing on what "active" means is a bug that surfaces as
        one feature working on a project while another quietly does not."""
        from app.workers.tasks import seo_tasks
        assert store_tasks.DORMANT_AFTER_DAYS == seo_tasks.DORMANT_AFTER_DAYS

    def test_one_failing_store_does_not_abort_the_batch(self):
        """Without this, a single merchant who revoked the app stops every
        other store on the platform from syncing."""
        src = inspect.getsource(store_tasks.sync_store_orders)
        assert "except Exception" in src
        assert "continue" in src or "failed += 1" in src

    def test_the_sync_window_stays_inside_shopify_s_limit(self):
        """read_orders only exposes 60 days; asking for more silently returns
        less and would make the window a lie."""
        from app.services.store_revenue_service import ORDER_WINDOW_DAYS
        assert 0 < store_tasks.SYNC_WINDOW_DAYS <= ORDER_WINDOW_DAYS


class TestCosts:
    def test_the_scheduled_sync_spends_no_credits(self):
        """The reason this job may run daily at all. If it ever starts metering,
        the frequency has to be re-argued -- so assert the absence."""
        src = inspect.getsource(store_tasks)
        for spender in ("record_llm", "record_seo", "call_llm", "bill_credits",
                        "_replicate_run", "record_replicate"):
            assert spender not in src, f"scheduled store sync must not reach {spender}"
