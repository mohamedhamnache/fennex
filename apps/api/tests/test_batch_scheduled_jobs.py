"""Batch mode (app.services.batch.scope.batch_scope) routes call_llm through
the 50%-off Batch API. Scheduled work is meant to opt in; a job reachable
from a user click must never enter it unconditionally, because that job would
then wait on a batch that can take up to 24h to settle for something someone
just asked to run now.

The previous version of this file asserted
`"batch_scope" in inspect.getsource(fn)` for each scheduled entrypoint. Every
one of them satisfied that check -- but only because each function's
docstring literally contains the words "never enters batch_scope()" while
explaining why it *doesn't*. The grep could not tell a call from a negation,
so it passed for every entrypoint while not one of them ever reached an LLM.
That defect is why this file is being rewritten rather than patched: a
docstring-shaped hole in a source-text assertion is exactly the kind of thing
review is supposed to catch before merge, not after.

As of commit 7ee5e9d the batch wiring for the cron entrypoints themselves was
removed outright (no cron job calls an LLM), so the true, current claim is
the reverse of the old test: none of the five scheduled entrypoints below
ever enters batch_scope. That is asserted here behaviourally, by running each
one against an empty database with a spy on the real batch_scope object,
rather than by re-grepping the docstrings that make the same claim in
English.

`keyword_tasks.run_keyword_research` is the only place in the codebase that
still calls batch_scope() at all, and only when a caller passes
`batched=True`. Nothing does today (no cron registers it; the router that
enqueues it never passes `batched`), so that path is currently dead code --
but the second test below proves the `batched` flag actually gates entry
into batch_scope rather than sitting there unused (the exact loophole the
old test's own comment worried about: "A `batched` parameter that sits
unused would still pass the check above").

One thing this file does NOT claim, because it would not be honest: that no
job enters batch_scope() without reaching an LLM. run_keyword_research's
batch_scope block wraps a call to the SEO data provider and deterministic
clustering -- there is no call_llm anywhere in it, batched or not. Entering
batch_scope there is harmless today only because nothing calls it with
batched=True; it is not evidence the wiring is correct for when something
eventually does.
"""
import uuid
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.organization import Organization
from app.models.project import Project
from app.models.keyword import KeywordResearchJob
from app.services.batch import scope as batch_scope_module
from app.workers.tasks import (autopilot_tasks, backlink_tasks, digest_tasks,
                               keyword_tasks, monitoring_tasks)

_engine = create_async_engine("sqlite+aiosqlite:///:memory:")
_Session = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def _empty_db():
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


_ORIGINAL_BATCH_SCOPE = batch_scope_module.batch_scope


def _spy_batch_scope(entries: list):
    """A stand-in for batch_scope that records entry and still delegates to
    the real one, so behaviour under it (e.g. batch_enabled()) is unchanged."""
    @contextmanager
    def _spy():
        entries.append(True)
        with _ORIGINAL_BATCH_SCOPE():
            yield
    return _spy


SCHEDULED = [
    (digest_tasks, "send_weekly_digests", {}),
    (monitoring_tasks, "run_market_monitor", {}),
    (monitoring_tasks, "run_competitor_monitor", {}),
    (backlink_tasks, "weekly_backlink_discovery", {"redis": None}),
    (autopilot_tasks, "run_autopilot_planner", {}),
]


async def test_scheduled_entrypoints_never_enter_batch_scope():
    """Run every scheduled cron entrypoint for real against an empty database
    (so each one's query trivially returns no rows and no per-row service
    call happens) and assert batch_scope was never entered -- a spy on the
    real contextmanager, not a grep on the docstring making the same claim."""
    entries: list = []
    with patch.object(batch_scope_module, "batch_scope", new=_spy_batch_scope(entries)):
        for module, name, ctx in SCHEDULED:
            with patch.object(module, "async_session_factory", new=_Session):
                await getattr(module, name)(dict(ctx))

    assert entries == [], (
        "a scheduled cron entrypoint entered batch_scope, but none of them "
        "call an LLM today -- see each function's own docstring")


async def _seed_keyword_job() -> str:
    org_id, project_id, job_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    async with _Session() as db:
        db.add(Organization(id=org_id, slug=f"o{job_id.hex[:10]}", name="O"))
        db.add(Project(id=project_id, org_id=org_id, name="P", domain="p.example"))
        db.add(KeywordResearchJob(id=job_id, org_id=org_id, project_id=project_id, seed_keyword="shoes"))
        await db.commit()
    return str(job_id)


async def test_user_triggerable_keyword_research_only_batches_when_asked():
    """The keywords router enqueues this job with no `batched` argument
    (see app/api/v1/routers/keywords.py), so the default call -- the only one
    a user click ever produces -- must never enter batch_scope. Passing
    batched=True explicitly must still enter it; otherwise the flag would be
    dead and every call would be equally (un)batched regardless of intent."""
    entries: list = []
    fake_provider = SimpleNamespace(get_keyword_ideas=AsyncMock(return_value=[]))

    with patch.object(keyword_tasks, "async_session_factory", new=_Session), \
         patch.object(keyword_tasks, "get_seo_provider", return_value=fake_provider), \
         patch.object(batch_scope_module, "batch_scope", new=_spy_batch_scope(entries)):

        job_id = await _seed_keyword_job()
        await keyword_tasks.run_keyword_research({}, job_id)
        assert entries == [], (
            "run_keyword_research entered batch_scope on the default, "
            "user-triggerable call (batched not passed)")

        job_id2 = await _seed_keyword_job()
        await keyword_tasks.run_keyword_research({}, job_id2, batched=True)
        assert entries == [True], (
            "batched=True must still enter batch_scope -- if it doesn't, "
            "the `batched` parameter is dead and the conditional is a no-op")
