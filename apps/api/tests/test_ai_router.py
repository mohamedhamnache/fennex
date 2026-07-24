"""The AI Router: intent, confidence ranking, ownership and handoff."""

import uuid

import pytest

from app.employees import registry, router as ai_router
from app.employees.brand_dna import BrandDNA
from app.employees.context import WorkContext
from app.employees.spec import Action, Employee


def _ctx(keys=None):
    """No keys by default -- exercises the deterministic keyword path."""
    return WorkContext(goal="", project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                       db=None, dna=BrandDNA(), keys=keys or {})


# --- the spec's routing examples ----------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("message,expected", [
    ("Write a blog article", "dune"),
    ("Write an SEO article about homemade lemonade", "dune"),
    ("Analyze my competitors", "sable"),
    ("Generate Instagram content", "sirocco"),
    ("Create product photos", "mirage"),
    ("Generate Pinterest images", "mirage"),
    ("Who are my ideal customers?", "oasis"),
    ("I want to contact restaurants", "nomad"),
    ("What should I write about to rank better?", "zerda"),
])
async def test_natural_language_reaches_the_right_specialist(message, expected):
    decision = await ai_router.route(message, _ctx())
    assert decision.primary is not None, f"{message!r} was not routed"
    assert decision.primary.id == expected
    assert decision.mode == ai_router.MODE_SINGLE


# --- confidence ---------------------------------------------------------------


def test_confidence_prefers_an_employee_that_can_act_over_one_that_declares():
    dune = registry.get("dune")
    backed = dune.confidence_score("write an article", ["content.article"])
    declared = dune.confidence_score("write an article", ["content.faq"])
    assert backed > declared > 0


def test_confidence_is_zero_outside_an_employees_field():
    assert registry.get("mirage").confidence_score("write a blog article",
                                                   ["content.article"]) == 0.0


def test_disabled_employees_never_win_work():
    employee = Employee(
        id="ghost", name="Ghost", codename="g", role="r", department="d",
        description="x", status="disabled", capabilities=["content.article"],
        actions=[Action(id="a", label="l", description="d",
                        capabilities=["content.article"], skill_key="dune.write_article")])
    assert employee.confidence_score("write an article", ["content.article"]) == 0.0


def test_ranking_is_ordered_and_name_free():
    intent = ai_router.Intent(capabilities=["content.article"])
    ranked = ai_router.rank("write an article", intent)
    assert ranked[0].employee.id == "dune"
    scores = [c.confidence for c in ranked]
    assert scores == sorted(scores, reverse=True)


# --- conversation ownership ---------------------------------------------------


@pytest.mark.asyncio
async def test_ambiguous_follow_up_stays_with_the_current_owner():
    decision = await ai_router.route("make it shorter and punchier", _ctx(),
                                     current_owner="dune")
    assert decision.primary.id == "dune"
    assert decision.handoff_from is None


@pytest.mark.asyncio
async def test_a_clear_topic_change_hands_the_thread_over():
    decision = await ai_router.route("now analyze my competitors instead", _ctx(),
                                     current_owner="dune")
    assert decision.primary.id == "sable"
    assert decision.handoff_from == "dune"


@pytest.mark.asyncio
async def test_ambiguous_message_with_no_owner_asks_for_clarification():
    decision = await ai_router.route("make it shorter", _ctx())
    assert decision.mode == ai_router.MODE_CLARIFY
    assert decision.primary is None


@pytest.mark.asyncio
async def test_the_incumbent_keeps_the_thread_on_a_narrow_margin():
    """A marginally better challenger must not steal a live conversation."""
    decision = await ai_router.route("write an article", _ctx(), current_owner="dune")
    assert decision.primary.id == "dune"
    assert decision.handoff_from is None


# --- collaboration ------------------------------------------------------------


def test_a_launch_assembles_the_whole_workflow():
    intent = ai_router.Intent(
        capabilities=["research.market_report", "intel.competitor_analysis",
                      "seo.opportunity_discovery", "content.article", "social.adaptation"],
        complexity="complex")
    team = ai_router.build_team(intent)
    assert [step["employeeId"] for step in team] == [
        "oasis", "sable", "zerda", "dune", "sirocco"]
    assert all(step["actionId"] for step in team)


def test_team_skips_capabilities_nobody_covers():
    intent = ai_router.Intent(capabilities=["content.article", "publish.wordpress"])
    team = ai_router.build_team(intent)
    assert [step["employeeId"] for step in team] == ["dune"]


# --- future-ready -------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_newly_registered_employee_wins_work_with_no_router_changes():
    atlas = Employee(
        id="atlas", name="Atlas", codename="The Map", role="Analytics Specialist",
        department="Analytics", description="Measures what shipped.",
        capabilities=["analytics.measure"],
        supported_tasks=["measure performance", "how did it perform", "report on results"],
        priority=70,
        actions=[Action(id="measure", label="Measure", description="Report on impact.",
                        capabilities=["analytics.measure"], skill_key="oasis.market_report")])
    registry.register(atlas)
    try:
        decision = await ai_router.route("measure performance of last month", _ctx())
        assert decision.primary is not None and decision.primary.id == "atlas"
    finally:
        registry.unregister("atlas")


def test_the_router_module_names_no_employee():
    """The whole point: routing must never hardcode who exists."""
    import inspect
    source = inspect.getsource(ai_router)
    for employee in registry.all_employees():
        assert employee.id not in source.lower(), (
            f"router.py mentions {employee.id} -- routing must stay name-free")
