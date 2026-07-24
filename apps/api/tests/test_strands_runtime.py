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


def test_the_loop_is_only_paid_for_where_it_can_pay_off():
    """Cost rule: the agentic loop costs N+1 round trips, each carrying the
    growing transcript. It is only worth that when the employee must decide
    what to fetch. An action with no tools, or whose tools the legacy path
    already pre-fetched, learns nothing from looping -- so it stays legacy.
    """
    from app.services.agents.registry import get_skill

    for employee in registry.all_employees():
        for action in employee.actions:
            if not action.agentic:
                continue
            assert employee.allowed_tools, (
                f"{employee.id}.{action.id} loops with no tools to call")
            skill = get_skill(action.skill_key) if action.skill_key else None
            prefetched = set(skill.tools) if skill else set()
            assert not prefetched >= set(employee.allowed_tools), (
                f"{employee.id}.{action.id} loops for data the legacy path "
                f"already pre-fetched")


def test_migrated_actions_are_flagged_and_the_rest_are_untouched():
    """Migration is per action, so a regression cannot reach the whole roster."""
    agentic, legacy = [], []
    for employee in registry.all_employees():
        for action in employee.actions:
            (agentic if action.agentic else legacy).append(f"{employee.id}.{action.id}")

    # Both paths are live and that is deliberate: the loop is paid for only
    # where it buys something.
    assert agentic and legacy
    for expected in ("zerda.pick_angle", "sable.competitor_scan",
                     "oasis.market_report", "dune.write_article"):
        assert expected in agentic
    for expected in ("sirocco.multi_network_social", "nomad.outreach_plan",
                     "mirage.product_shot"):
        assert expected in legacy


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


# --- MCP ----------------------------------------------------------------------


def test_an_unconfigured_mcp_server_is_never_offered():
    """Declaring an app costs nothing until an endpoint is configured."""
    from app.employees.runtime import mcp

    nomad = registry.get("nomad")
    assert "linkedin" in nomad.connected_apps
    # No MCP_* endpoints are set in this environment.
    assert mcp.servers_for(nomad, ALL_PERMISSIONS) == []
    assert mcp.clients_for(nomad, ALL_PERMISSIONS) == []


def test_mcp_respects_the_same_permission_gate_as_native_tools():
    from app.employees.runtime import mcp

    server = mcp.CATALOGUE["email"]
    assert server.permission == "send:email"
    nomad = registry.get("nomad")
    # Even fully configured, a run without the permission gets nothing.
    assert mcp.servers_for(nomad, granted=[]) == []


def test_describe_reports_configuration_state_for_the_ui():
    from app.employees.runtime import mcp

    described = mcp.describe(registry.get("nomad"))
    assert {d["app"] for d in described} == {"linkedin", "email"}
    assert all(d["configured"] is False for d in described)
    assert all(d["permission"] for d in described)


def test_mcp_tools_degrade_to_nothing_rather_than_failing_a_turn():
    """A broken integration must never cost the user their answer."""
    from contextlib import ExitStack

    from app.employees.runtime.base import BaseEmployee

    with ExitStack() as stack:
        assert BaseEmployee(registry.get("nomad"))._mcp_tools(_ctx(), stack) == []


def test_toolless_employees_have_an_mcp_route_to_gain_tools():
    """They run on the runtime already; MCP is how they gain reach."""
    from app.employees.runtime import mcp

    for employee_id in ("sirocco", "nomad"):
        employee = registry.get(employee_id)
        assert employee.allowed_tools == []
        assert mcp.describe(employee), f"{employee_id} has no MCP route to reach"


def test_a_read_only_tool_is_not_called_twice_in_one_run():
    """A reasoning model will ask the same tool repeatedly; the data cannot
    change mid-turn, so the first answer is reused."""
    import asyncio

    from app.employees import toolbelt

    calls = []

    async def _counting(ctx, db, inputs):
        calls.append(inputs.get("query", ""))
        return {"rows": 1}

    toolbelt.register_tool(toolbelt.Tool(
        name="test_cached", label="Cached", description="d",
        permission="read:analytics", handler=_counting))
    try:
        from app.employees.spec import Action, Employee
        employee = Employee(
            id="cache-probe", name="Probe", codename="p", role="r", department="d",
            description="x", allowed_tools=["test_cached"],
            actions=[Action(id="a", label="l", description="d",
                            capabilities=["seo.keyword_research"],
                            skill_key="zerda.keyword_targets")])
        tool = toolbridge.build_tools(employee, _ctx())[0]
        run = getattr(tool, "_tool_func", None) or getattr(tool, "func", None) or tool

        async def drive():
            await run(query="x")
            await run(query="x")      # cached
            await run(query="y")      # different args, runs again

        asyncio.get_event_loop().run_until_complete(drive()) \
            if False else asyncio.run(drive())
        assert calls == ["x", "y"], f"expected one call per distinct query, got {calls}"
    finally:
        toolbelt._TOOLS.pop("test_cached", None)


def test_a_run_cannot_spend_more_than_its_tool_budget():
    """A model that is unsure keeps asking; one observed run made 14 calls."""
    import asyncio

    from app.employees import toolbelt
    from app.employees.spec import Action, Employee

    calls = []

    async def _counting(ctx, db, inputs):
        calls.append(inputs.get("query", ""))
        return {"n": len(calls)}

    toolbelt.register_tool(toolbelt.Tool(
        name="test_budget", label="Budget", description="d",
        permission="read:analytics", handler=_counting))
    try:
        employee = Employee(
            id="budget-probe", name="Probe", codename="p", role="r", department="d",
            description="x", allowed_tools=["test_budget"],
            actions=[Action(id="a", label="l", description="d",
                            capabilities=["seo.keyword_research"],
                            skill_key="zerda.keyword_targets")])
        tool = toolbridge.build_tools(employee, _ctx())[0]
        run = getattr(tool, "_tool_func", None) or getattr(tool, "func", None) or tool

        async def drive():
            # Distinct queries, so the cache never absorbs them.
            for i in range(toolbridge.MAX_TOOL_CALLS + 4):
                await run(query=f"q{i}")

        asyncio.run(drive())
        assert len(calls) == toolbridge.MAX_TOOL_CALLS, (
            f"budget not enforced: {len(calls)} calls")
    finally:
        toolbelt._TOOLS.pop("test_budget", None)


# --- connectors ---------------------------------------------------------------


def test_a_connector_is_only_reachable_by_an_employee_that_declared_it():
    """Connecting a tool makes it available, not accessible."""
    from app.employees.runtime import mcp

    configured = {"linkedin": mcp.MCPServer(
        app="linkedin", label="LinkedIn", url="https://mcp.example.com",
        permission="publish:external")}

    # Nomad declares linkedin; Zerda does not.
    assert mcp.servers_for(registry.get("nomad"), ALL_PERMISSIONS, configured)
    assert mcp.servers_for(registry.get("zerda"), ALL_PERMISSIONS, configured) == []


def test_a_connector_still_obeys_the_permission_gate():
    from app.employees.runtime import mcp

    configured = {"email": mcp.MCPServer(
        app="email", label="Email", url="https://mcp.example.com",
        permission="send:email")}
    nomad = registry.get("nomad")
    assert mcp.servers_for(nomad, ["send:email"], configured)
    assert mcp.servers_for(nomad, ["read:content"], configured) == []


def test_an_org_connector_overrides_the_environment_default():
    from app.employees.runtime import mcp

    configured = {"linkedin": mcp.MCPServer(
        app="linkedin", label="LinkedIn", url="https://org-specific.example.com",
        permission="publish:external")}
    found = mcp.servers_for(registry.get("nomad"), ALL_PERMISSIONS, configured)
    assert [s.url for s in found if s.app == "linkedin"] == ["https://org-specific.example.com"]


def test_a_disabled_or_urlless_connector_is_not_offered():
    from app.employees.runtime import mcp

    configured = {"linkedin": mcp.MCPServer(
        app="linkedin", label="LinkedIn", url="", permission="publish:external")}
    assert mcp.servers_for(registry.get("nomad"), ALL_PERMISSIONS, configured) == []


def test_the_crawl_tool_does_not_re_enter_the_scan_skill():
    """crawl_competitor used to call competitor_service.analyze(), which runs
    the Sable scan skill, whose own tool is crawl_competitor -- so a scan
    crawled, scanned, crawled and never finished."""
    import inspect

    from app.services.agents import tools as legacy

    source = inspect.getsource(legacy.crawl_competitor)
    assert "scan_scorecard" in source
    # Match a call or an import, not the comment that explains the bug.
    assert "_analyze(" not in source and "import analyze" not in source, (
        "crawl_competitor must not call analyze(): that path runs the scan "
        "skill, which calls this tool again")


def test_a_tool_declares_the_input_key_it_reads():
    """The bridge passed only "query"; adapted tools read their own key, so a
    URL handed to crawl_competitor was silently discarded."""
    from app.employees import toolbelt

    assert toolbelt.get_tool("crawl_competitor").arg == "competitor_url"
    assert toolbelt.get_tool("article_context").arg == "article_id"
    assert toolbelt.get_tool("seo_grounding").arg == "article_id"


def test_the_scout_can_discover_competitors_not_only_crawl_them():
    scout = registry.get("sable")
    assert "known_competitors" in scout.allowed_tools
    assert "serp_lookup" in scout.allowed_tools


# --- spend ceilings -----------------------------------------------------------


def test_every_run_has_a_turn_token_and_time_ceiling():
    """An agentic loop is open-ended by construction; nothing may run unbounded."""
    from app.employees.runtime import budget

    for action in registry.get("dune").actions:
        spend = budget.for_action(action)
        assert spend.turns > 0
        assert spend.total_tokens > 0
        assert spend.output_tokens > 0
        assert spend.seconds > 0


def test_a_light_action_gets_a_smaller_budget_than_a_heavy_one():
    from app.employees.runtime import budget

    light = budget.for_action(registry.get("zerda").action("pick_angle"))
    heavy = budget.for_action(registry.get("dune").action("write_article"))
    assert light.total_tokens < heavy.total_tokens
    assert light.seconds <= heavy.seconds


def test_a_chat_reply_is_capped_tighter_than_a_deep_action():
    from app.employees.runtime import budget

    action = registry.get("dune").action("write_article")
    assert (budget.for_action(action, conversational=True).output_tokens
            < budget.for_action(action).output_tokens)


def test_the_tool_budget_is_finite():
    assert 0 < toolbridge.MAX_TOOL_CALLS <= 20


def test_only_a_catalogued_model_on_a_configured_provider_can_be_chosen():
    """A picker must not be able to select something the account cannot run."""
    keys = {"openai": "k"}
    assert model_provider.is_allowed("openai", "gpt-4o", keys)
    assert not model_provider.is_allowed("openai", "not-a-model", keys)
    assert not model_provider.is_allowed("anthropic", "claude-opus-4-8", keys)


def test_an_unusable_model_choice_falls_back_to_the_tier():
    _model, choice = model_provider.for_action(
        "balanced", "light", {"openai": "k"},
        provider_override="anthropic", model_override="claude-opus-4-8")
    assert choice.provider == "openai"


def test_competitor_search_is_planned_from_what_the_business_is():
    """Concatenating scope words onto keywords finds whoever ranks for the
    terms -- for a cosmetics brand that is blogs and wholesalers. Planning must
    describe the business and search for its peers."""
    import inspect

    from app.employees import toolbelt

    source = inspect.getsource(toolbelt._plan_competitor_search)
    assert "business_type" in source and "queries" in source
    # The superseded string-concatenation helpers must not come back.
    assert not hasattr(toolbelt, "_qualified")
    assert not hasattr(toolbelt, "_scope_terms")


def test_a_project_with_no_context_is_told_so_rather_than_guessed_at():
    import asyncio

    from app.employees import toolbelt

    class _Bare:
        name = ""
        domain = ""
        description = None
        industry = None
        target_country = None
        locale = "en"

    class _Ctx:
        keys: dict = {}
        tier = "balanced"
        locale = "en"

    plan = asyncio.run(toolbelt._plan_competitor_search(_Bare(), _Ctx(), []))
    assert plan["queries"] == []
    assert plan["source"] == "fallback"


def test_platforms_are_never_returned_as_competitors():
    from app.employees.toolbelt import _NOT_COMPETITORS

    for domain in ("youtube.com", "wikipedia.org", "amazon.fr", "pinterest.com"):
        assert domain in _NOT_COMPETITORS
