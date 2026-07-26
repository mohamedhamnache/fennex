"""Scheduled work runs on the 50%-off batch path; the same work triggered by a
user stays interactive, because a job that settles tomorrow is not what someone
who clicked 'run' asked for."""
import inspect

from app.workers.tasks import (autopilot_tasks, backlink_tasks, digest_tasks,
                               keyword_tasks, monitoring_tasks)

SCHEDULED = [
    (digest_tasks, "send_weekly_digests"),
    (monitoring_tasks, "run_market_monitor"),
    (monitoring_tasks, "run_competitor_monitor"),
    (backlink_tasks, "weekly_backlink_discovery"),
    (autopilot_tasks, "run_autopilot_planner"),
]


def test_scheduled_entrypoints_enter_a_batch_scope():
    for module, name in SCHEDULED:
        source = inspect.getsource(getattr(module, name))
        assert "batch_scope" in source, f"{name} does not run on the batch path"


def test_user_triggerable_keyword_research_is_not_unconditionally_batched():
    source = inspect.getsource(keyword_tasks.run_keyword_research)
    if "batch_scope" in source:
        assert "batched" in inspect.signature(keyword_tasks.run_keyword_research).parameters, (
            "run_keyword_research is reachable from a router, so batching must be "
            "opt-in per call, not unconditional")
