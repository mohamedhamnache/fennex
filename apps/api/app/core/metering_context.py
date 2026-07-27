"""Ambient organization context for usage metering.

Every LLM call must first resolve the org's API key via
``llm_service.get_org_llm_keys(org_id, db)`` — you cannot call a provider
without its key. That makes key resolution the one choke point every LLM call
passes through, for BOTH request handlers and background workers. We stash the
org id there (and at the auth boundary as a belt-and-suspenders) so
``call_llm`` can attribute usage to that org without every caller having to
thread a ``meter`` dict through. The value is a contextvar, so it is
task-local and propagates through ``await`` within the same call chain.
"""
import contextvars
import uuid

_metering_org: contextvars.ContextVar[uuid.UUID | None] = contextvars.ContextVar(
    "metering_org", default=None
)


def set_metering_org(org_id: uuid.UUID | None) -> None:
    _metering_org.set(org_id)


def get_metering_org() -> uuid.UUID | None:
    return _metering_org.get()
