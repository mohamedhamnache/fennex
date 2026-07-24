"""The Strands runtime layer.

Strands is the execution engine only. These tests guard the boundary: business
logic must not leak into the runtime, and the runtime must not leak upward.
"""

import inspect
import uuid

import pytest

from app.employees import registry
from app.employees.brand_dna import BrandDNA
from app.employees.context import WorkContext
from app.employees.runtime import models as model_provider
from app.employees.runtime import toolbridge
from app.employees.runtime.base import BaseEmployee
from app.employees.runtime.telemetry import Execution
from app.employees.spec import ALL_PERMISSIONS, P_READ_ANALYTICS


def _ctx(keys=None, granted=None):
    return WorkContext(goal="Grow organic traffic", project_id=uuid.uuid4(),
                       org_id=uuid.uuid4(), db=None, dna=BrandDNA(),
                       tier="balanced", keys=keys if keys is not None else {"openai": "k"},
                       granted_permissions=list(granted if granted is not None
                                                else ALL_PERMISSIONS))


# --- the architectural boundary -----------------------------------------------


def test_only_the_runtime_package_imports_strands():
    """Business logic must never couple to the runtime."""
    import pathlib
    root = pathlib.Path(inspect.getfile(registry)).parent
    offenders = []
    for path in root.rglob("*.py"):
        if "runtime" in path.parts:
            continue
        if "strands" in path.read_text():
            offenders.append(path.name)
    assert not offenders, f"strands leaked outside runtime/: {offenders}"


def test_the_router_never_imports_strands():
    from app.employees import router
    assert "strands" not in inspect.getsource(router)


def test_the_registry_never_imports_strands():
    assert "strands" not in inspect.getsource(registry)


# --- model provider abstraction -----------------------------------------------


def test_the_tier_decides_the_model_not_the_employee():
    light = model_provider.resolve("balanced", "light", ["openai"])
    heavy = model_provider.resolve("balanced", "heavy", ["openai"])
    assert light.provider == heavy.provider == "openai"
    assert heavy.max_tokens > light.max_tokens


def test_a_heavy_action_gets_room_for_a_long_answer():
    assert model_provider.resolve("max", "heavy", ["anthropic"]).max_tokens >= 8192


def test_no_configured_provider_is_a_clear_error():
    with pytest.raises(model_provider.ModelUnavailable):
        model_provider.resolve("balanced", "light", [])


def test_an_unknown_provider_is_ignored_rather_than_chosen():
    with pytest.raises(model_provider.ModelUnavailable):
        model_provider.resolve("balanced", "light", ["mystery-llm"])


# --- allowed_tools is now a real boundary -------------------------------------


def test_an_employee_only_receives_the_tools_it_declared():
    zerda = registry.get("zerda")
    tools = toolbridge.build_tools(zerda, _ctx())
    assert len(tools) == len(zerda.allowed_tools)


def test_a_tool_whose_permission_is_not_granted_is_never_offered():
    """The model cannot call what it is never handed."""
    zerda = registry.get("zerda")
    assert P_READ_ANALYTICS in zerda.permissions
    withheld = toolbridge.build_tools(zerda, _ctx(granted=[]))
    assert withheld == []


def test_an_employee_with_no_tools_gets_none():
    sirocco = registry.get("sirocco")
    assert sirocco.allowed_tools == []
    assert toolbridge.build_tools(sirocco, _ctx()) == []


def test_describe_reports_why_a_tool_is_unavailable():
    described = toolbridge.describe(registry.get("zerda"), _ctx(granted=[]))
    assert described and all(not d["available"] for d in described)
    assert all("not granted" in d["reason"] for d in described)


# --- telemetry ----------------------------------------------------------------


def test_execution_records_what_a_run_cost():
    metrics = Execution(employee_id="zerda", action_id="pick_angle")
    metrics.provider, metrics.model_id = "openai", "gpt-4o-mini"
    metrics.record_tool("gsc_opportunities", True)
    metrics.record_tool("our_demand", False)
    metrics.prompt_tokens, metrics.completion_tokens = 1200, 400
    data = metrics.finish(ok=True).to_dict()

    assert data["toolCalls"] == ["gsc_opportunities", "our_demand"]
    assert data["toolFailures"] == ["our_demand"]
    assert data["totalTokens"] == 1600
    assert data["ok"] is True and data["latencyMs"] >= 0


def test_missing_usage_costs_a_number_not_the_run():
    metrics = Execution(employee_id="x", action_id="y")
    metrics.absorb_usage(object())          # no metrics attribute at all
    assert metrics.total_tokens == 0


# --- BaseEmployee --------------------------------------------------------------


def test_instructions_carry_identity_task_and_tool_discipline():
    zerda = registry.get("zerda")
    action = zerda.action("pick_angle")
    text = BaseEmployee(zerda).instructions(_ctx(), action)
    assert "Zerda" in text
    assert action.label in text
    assert "tools" in text.lower()
    assert "do it" in text.lower()


def test_the_prompt_carries_settled_context_so_nothing_is_re_asked():
    from app.employees.context import Task
    zerda = registry.get("zerda")
    task = Task(id="t", goal="Egg substitutes", capabilities=["seo.opportunity_discovery"],
                inputs={"title": "Comment remplacer les oeufs", "keyword": "remplacer les oeufs"})
    prompt = BaseEmployee(zerda).build_prompt(zerda.action("pick_angle"), task, _ctx())
    assert "Comment remplacer les oeufs" in prompt
    assert "remplacer les oeufs" in prompt
    assert "do not ask again" in prompt.lower()


@pytest.mark.asyncio
async def test_a_run_without_a_provider_fails_cleanly():
    from app.employees.context import Task
    zerda = registry.get("zerda")
    action = zerda.action("pick_angle")
    task = Task(id="t", goal="x", capabilities=list(action.capabilities))
    outcome = await BaseEmployee(zerda).execute(action, task, _ctx(keys={}))
    assert outcome.ok is False
    assert "key" in (outcome.error or "").lower()


# --- migration state -----------------------------------------------------------


def test_migrated_actions_are_flagged_and_the_rest_are_untouched():
    """Migration is per action, so a regression cannot reach the whole roster."""
    agentic, legacy = [], []
    for employee in registry.all_employees():
        for action in employee.actions:
            (agentic if action.agentic else legacy).append(f"{employee.id}.{action.id}")
    assert "zerda.pick_angle" in agentic
    assert "zerda.keyword_targets" in agentic
    # Everything not yet migrated still runs the proven legacy path.
    assert "dune.write_article" in legacy
    assert "mirage.editorial_image" in legacy


def test_every_agentic_action_belongs_to_an_employee_with_usable_tools():
    for employee in registry.all_employees():
        for action in employee.actions:
            if not action.agentic:
                continue
            unknown = toolbridge.describe(employee, _ctx())
            assert all(u.get("label") for u in unknown), (
                f"{employee.id} declares a tool the toolbelt does not know")
