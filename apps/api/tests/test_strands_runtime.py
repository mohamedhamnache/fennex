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


def test_instructions_carry_identity_craft_and_tool_discipline():
    zerda = registry.get("zerda")
    action = zerda.action("pick_angle")
    text = BaseEmployee(zerda).instructions(_ctx(), action)
    assert "Zerda" in text                       # identity
    assert "json" in text.lower()                # the skill's output contract
    assert "tools" in text.lower()               # tool discipline
    assert "do it" in text.lower()               # produce, do not describe


def test_instructions_fall_back_to_the_action_when_no_skill_is_bound():
    """An action with only a handler still gets a usable task statement."""
    from app.employees.spec import Action, Employee

    employee = Employee(
        id="tmp", name="Tmp", codename="t", role="r", department="d", description="x",
        actions=[Action(id="a", label="Do the thing", description="A thing.",
                        capabilities=["content.article"], handler=lambda *a, **k: None)])
    text = BaseEmployee(employee).instructions(_ctx(), employee.action("a"))
    assert "Do the thing" in text


def test_settled_context_survives_a_skills_own_prompt():
    """A skill may build its prompt from the goal alone and ignore inputs, so
    the agreed title and keyword must be appended rather than replaced."""
    from app.employees.context import Task

    zerda = registry.get("zerda")
    task = Task(id="t", goal="Egg substitutes", capabilities=["seo.opportunity_discovery"],
                inputs={"title": "Comment remplacer les oeufs",
                        "keyword": "remplacer les oeufs"})
    prompt = BaseEmployee(zerda).build_prompt(zerda.action("pick_angle"), task, _ctx())
    assert "Comment remplacer les oeufs" in prompt
    assert "do not ask again" in prompt.lower()


def test_upstream_output_and_reviewer_feedback_reach_the_prompt():
    from app.employees.context import Task

    zerda = registry.get("zerda")
    task = Task(id="t", goal="g", capabilities=["seo.opportunity_discovery"],
                inputs={"upstream": "The article covers flax and aquafaba.",
                        "feedback": "Be more specific about baking."})
    prompt = BaseEmployee(zerda).build_prompt(zerda.action("pick_angle"), task, _ctx())
    assert "flax and aquafaba" in prompt
    assert "Be more specific about baking" in prompt


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


def test_only_employees_with_tools_are_migrated():
    """An agentic loop with no tools is risk without benefit.

    Sirocco and Nomad declare no tools, so the runtime could never call
    anything on their behalf -- they stay on the proven legacy path until MCP
    gives them something to reach for.
    """
    for employee in registry.all_employees():
        migrated = [a.id for a in employee.actions if a.agentic]
        if migrated:
            assert employee.allowed_tools, (
                f"{employee.id} is agentic but has no tools to call")


def test_migrated_actions_are_flagged_and_the_rest_are_untouched():
    """Migration is per action, so a regression cannot reach the whole roster."""
    agentic, legacy = [], []
    for employee in registry.all_employees():
        for action in employee.actions:
            (agentic if action.agentic else legacy).append(f"{employee.id}.{action.id}")

    for migrated in ("zerda.pick_angle", "zerda.keyword_targets",
                     "sable.competitor_scan", "oasis.market_report",
                     "oasis.define_icp", "dune.write_article"):
        assert migrated in agentic

    # Toolless employees remain on the legacy generator.
    for untouched in ("sirocco.multi_network_social", "sirocco.generate_visual",
                      "nomad.outreach_plan", "mirage.product_shot"):
        assert untouched in legacy


def test_an_agentic_action_bound_to_a_skill_inherits_its_prompts():
    """Dropping the skill's system prompt loses the output contract -- which is
    how a JSON action ends up returning prose."""
    from app.employees.context import Task

    zerda = registry.get("zerda")
    action = zerda.action("pick_angle")
    task = Task(id="t", goal="Egg substitutes", capabilities=list(action.capabilities))
    system, user = BaseEmployee(zerda)._skill_prompts(action, task, _ctx())
    assert system and user
    assert "json" in system.lower()


def test_every_agentic_action_belongs_to_an_employee_with_usable_tools():
    for employee in registry.all_employees():
        for action in employee.actions:
            if not action.agentic:
                continue
            unknown = toolbridge.describe(employee, _ctx())
            assert all(u.get("label") for u in unknown), (
                f"{employee.id} declares a tool the toolbelt does not know")
