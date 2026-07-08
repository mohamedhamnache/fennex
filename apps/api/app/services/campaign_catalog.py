from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


@dataclass
class CampaignContext:
    goal: str
    persona: str
    project_profile: str
    prior: list[dict] = field(default_factory=list)


@dataclass
class StepResult:
    summary: str
    artifact_type: str | None = None
    artifact_ids: list[str] = field(default_factory=list)
    structured: dict = field(default_factory=dict)


@dataclass
class ActionDef:
    key: str
    agent: str
    label: str
    description: str
    params: dict[str, str]  # name -> human description, for the director
    executor: Callable[..., Awaitable["StepResult"]]


def _build_actions() -> dict[str, ActionDef]:
    from app.services import campaign_executors as ex
    defs = [
        ActionDef("oasis.market_report", "oasis", "Market report",
                  "Generate a client-ready market report from the project's Search Console data.",
                  {}, ex.exec_oasis_market_report),
        ActionDef("zerda.pick_angle", "zerda", "Pick the angle",
                  "Choose one focus topic + target keyword from the project's real opportunities.",
                  {}, ex.exec_zerda_pick_angle),
    ]
    return {d.key: d for d in defs}


_actions_cache: dict[str, ActionDef] | None = None


def __getattr__(name: str):
    # Lazily build ACTIONS on first access (PEP 562) instead of at import time.
    # campaign_executors imports this module at module scope, so eagerly building
    # ACTIONS here would create a circular import when campaign_executors (or its
    # exec_* functions) is imported before campaign_catalog has finished loading.
    global _actions_cache
    if name == "ACTIONS":
        if _actions_cache is None:
            _actions_cache = _build_actions()
        return _actions_cache
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
