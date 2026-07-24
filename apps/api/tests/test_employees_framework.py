"""The AI Employee Framework: registry, capability routing, planning, permissions."""

import uuid

import pytest

from app.employees import capabilities as caps
from app.employees import orchestrator, registry
from app.employees.brand_dna import BrandDNA
from app.employees.context import Task, WorkContext
from app.employees.memory import SCOPE_DEPARTMENT, SCOPE_ORG, SCOPE_PROJECT, SCOPE_SELF, _readable
from app.employees.spec import Action, Employee, P_WRITE_CONTENT


def _ctx(goal="Grow organic traffic", persona="creator"):
    return WorkContext(goal=goal, project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                       db=None, dna=BrandDNA(), persona=persona)


# --- registry -----------------------------------------------------------------


def test_roster_is_discovered_not_hardcoded():
    employees = registry.all_employees()
    ids = {e.id for e in employees}
    assert {"zerda", "dune", "sirocco", "mirage", "sable", "oasis", "nomad"} <= ids
    assert registry.stats()["actions"] >= 13


def test_every_employee_has_a_complete_contract():
    for e in registry.all_employees():
        assert e.name and e.role and e.department and e.description
        assert e.personality and e.system_prompt, f"{e.id} has no prompt"
        assert e.capabilities and e.actions, f"{e.id} cannot do anything"
        assert e.permissions, f"{e.id} has no permissions"
        assert e.memory_scope and e.knowledge_sources
        assert e.supported_inputs and e.supported_outputs


def test_declared_capabilities_are_all_in_the_taxonomy():
    for e in registry.all_employees():
        assert not caps.unknown(e.capabilities), f"{e.id} declares unknown capabilities"


def test_every_action_binds_to_a_real_skill():
    from app.services.agents.registry import get_skill
    for e in registry.all_employees():
        for a in e.actions:
            if a.skill_key:
                assert get_skill(a.skill_key) is not None, f"{e.id}.{a.id} -> {a.skill_key}"


def test_versions_resolve_to_the_highest():
    base = registry.get("zerda")
    upgraded = Employee(
        id="zerda", name="Zerda", codename="x", role=base.role, department=base.department,
        description="v2", version="2.0.0", capabilities=["seo.keyword_research"],
        actions=[Action(id="pick_angle", label="l", description="d",
                        capabilities=["seo.keyword_research"], skill_key="zerda.pick_angle")],
    )
    registry.register(upgraded)
    try:
        assert registry.get("zerda").version == "2.0.0"
        assert registry.get("zerda", version="1.0.0").version == "1.0.0"
        assert "2.0.0" in registry.versions("zerda")
    finally:
        registry.unregister("zerda", version="2.0.0")
    assert registry.get("zerda").version == "1.0.0"


# --- capability-based selection ------------------------------------------------


@pytest.mark.parametrize("capability,expected", [
    ("content.article", "dune"),
    ("image.product_photography", "mirage"),
    ("research.icp", "oasis"),
    ("intel.content_gap", "sable"),
    ("seo.opportunity_discovery", "zerda"),
    ("social.linkedin", "sirocco"),
    ("outreach.linkedin", "nomad"),
])
def test_work_routes_by_capability_never_by_name(capability, expected):
    employee, action = registry.resolve_action(capability)
    assert employee is not None and employee.id == expected
    assert action is not None and capability in action.capabilities


def test_a_new_hire_becomes_selectable_with_no_code_changes():
    atlas = Employee(
        id="atlas", name="Atlas", codename="The Map", role="Analytics Specialist",
        department="Analytics", description="Measures what shipped.",
        capabilities=["analytics.measure"],
        actions=[Action(id="measure", label="Measure", description="Report on impact.",
                        capabilities=["analytics.measure"], skill_key="oasis.market_report")],
        permissions=[P_WRITE_CONTENT],
    )
    before = registry.stats()["employees"]
    registry.register(atlas)
    try:
        assert registry.stats()["employees"] == before + 1
        employee, action = registry.resolve_action("analytics.measure")
        assert employee.id == "atlas" and action.id == "measure"
        tasks = orchestrator.build_plan(["content.article", "analytics.measure"], "g", _ctx())
        assert [t.employee_id for t in tasks] == ["dune", "atlas"]
    finally:
        registry.unregister("atlas")
    assert registry.best_for("analytics.measure") is None


def test_greedy_team_covers_the_wanted_capabilities():
    team = registry.find_for_goals(["content.article", "image.product_photography",
                                    "research.icp"])
    covered = {c for e in team for c in e.capabilities}
    assert {"content.article", "image.product_photography", "research.icp"} <= covered
    assert len(team) == 3


# --- planning -----------------------------------------------------------------


def test_plan_chains_dependencies_in_execution_order():
    ctx = _ctx()
    tasks = orchestrator.build_plan(
        ["seo.opportunity_discovery", "content.article", "social.adaptation"], ctx.goal, ctx)
    assert [t.employee_id for t in tasks] == ["zerda", "dune", "sirocco"]
    assert tasks[0].depends_on == []
    assert tasks[1].depends_on == [tasks[0].id]
    assert tasks[2].depends_on == [tasks[1].id]


def test_research_and_intelligence_run_in_parallel():
    ctx = _ctx()
    tasks = orchestrator.build_plan(
        ["research.market_report", "intel.competitor_analysis", "content.article"],
        ctx.goal, ctx)
    layers = orchestrator.layers(tasks)
    assert len(layers[0]) == 2, "ground-truth work should start concurrently"
    assert {t.employee_id for t in layers[0]} == {"oasis", "sable"}
    assert [t.employee_id for t in layers[1]] == ["dune"]


def test_unstaffed_capability_is_skipped_and_logged():
    ctx = _ctx()
    tasks = orchestrator.build_plan(
        ["content.article", "publish.wordpress"], ctx.goal, ctx)
    assert [t.employee_id for t in tasks] == ["dune"]
    assert any(entry.event == "plan.unstaffed" for entry in ctx.logs)


def test_layers_never_deadlock_on_a_broken_graph():
    a = Task(id="a", goal="g", depends_on=["b"])
    b = Task(id="b", goal="g", depends_on=["a"])
    layers = orchestrator.layers([a, b])
    assert sum(len(layer) for layer in layers) == 2


# --- permissions --------------------------------------------------------------


def test_action_is_denied_when_the_org_has_not_granted_the_permission():
    ctx = _ctx()
    ctx.granted_permissions = []
    dune = registry.get("dune")
    refusal = orchestrator._authorize(dune, dune.action("write_article"), ctx)
    assert refusal and "write:content" in refusal


def test_action_is_allowed_once_granted():
    ctx = _ctx()
    ctx.granted_permissions = [P_WRITE_CONTENT]
    dune = registry.get("dune")
    assert orchestrator._authorize(dune, dune.action("write_article"), ctx) is None


def test_action_requiring_approval_waits_for_a_human():
    ctx = _ctx()
    ctx.granted_permissions = [P_WRITE_CONTENT]
    employee = Employee(
        id="tmp", name="Tmp", codename="t", role="r", department="d", description="x",
        permissions=[P_WRITE_CONTENT],
        actions=[Action(id="risky", label="l", description="d",
                        capabilities=["content.article"], skill_key="dune.write_article",
                        requires_permissions=[P_WRITE_CONTENT], requires_approval=True)],
    )
    action = employee.action("risky")
    assert "approval" in orchestrator._authorize(employee, action, ctx)
    ctx.approvals["tmp.risky"] = True
    assert orchestrator._authorize(employee, action, ctx) is None


# --- memory visibility --------------------------------------------------------


class _Row:
    def __init__(self, scope, employee_id="oasis", department="Research", project_id=None):
        self.scope, self.employee_id = scope, employee_id
        self.department, self.project_id = department, project_id


def test_org_memory_is_visible_to_everyone():
    row = _Row(SCOPE_ORG)
    assert _readable(row, employee_id="dune", department="Content", project_id=uuid.uuid4())


def test_self_memory_is_private_to_its_author():
    row = _Row(SCOPE_SELF, employee_id="dune")
    assert _readable(row, employee_id="dune", department="Content", project_id=None)
    assert not _readable(row, employee_id="zerda", department="Strategy", project_id=None)


def test_department_memory_stays_in_its_department():
    row = _Row(SCOPE_DEPARTMENT, department="Research")
    assert _readable(row, employee_id="oasis", department="Research", project_id=None)
    assert not _readable(row, employee_id="dune", department="Content", project_id=None)


def test_project_memory_is_scoped_to_its_project():
    pid, other = uuid.uuid4(), uuid.uuid4()
    row = _Row(SCOPE_PROJECT, project_id=pid)
    assert _readable(row, employee_id="dune", department="Content", project_id=pid)
    assert not _readable(row, employee_id="dune", department="Content", project_id=other)


def test_org_scoped_employee_still_reads_project_knowledge():
    """Oasis writes at org scope but must still see the project it works on."""
    pid = uuid.uuid4()
    assert registry.get("oasis").memory_scope == SCOPE_ORG
    row = _Row(SCOPE_PROJECT, project_id=pid)
    assert _readable(row, employee_id="oasis", department="Research", project_id=pid)


# --- brand dna ----------------------------------------------------------------


def test_brand_dna_renders_voice_for_writers_and_palette_for_artists():
    dna = BrandDNA(mission="Make good coffee accessible", voice="Warm, direct",
                   tone="friendly", colors=["#8B4513", "#F5DEB3"], typography="Fraunces",
                   avoid_words=["synergy"], audience="Home baristas")
    written = dna.as_prompt(visual=False)
    assert "Warm, direct" in written and "synergy" in written
    assert "Fraunces" not in written

    visual = dna.as_prompt(visual=True)
    assert "Fraunces" in visual and "#8B4513" in visual
    assert "Never ask the user for it" in visual


def test_empty_brand_dna_injects_nothing():
    assert BrandDNA().as_prompt() == ""


def test_context_exposes_the_legacy_brief_surface():
    """Existing skills read brief.brand / brief.locale -- that must keep working."""
    ctx = _ctx()
    ctx.dna = BrandDNA(voice="v", tone="t", colors=["#000"], locale="fr")
    assert ctx.locale == "fr"
    assert ctx.brand["voice_prompt"] == "v"
    assert ctx.brand["kit"]["colors"] == ["#000"]
