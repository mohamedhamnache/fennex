"""Routing strategy: compound requests, delivery order, and precision.

The bug these guard against: "create an article with a featured image" routed
to the writer alone and silently dropped the image.
"""

import uuid

import pytest

from app.employees import registry, router as ai_router
from app.employees.brand_dna import BrandDNA
from app.employees.context import WorkContext


def _ctx():
    """No keys -- exercises the deterministic keyword path, the weakest case."""
    return WorkContext(goal="", project_id=uuid.uuid4(), org_id=uuid.uuid4(),
                       db=None, dna=BrandDNA(), keys={})


async def _team(message: str) -> list[str]:
    decision = await ai_router.route(message, _ctx())
    if decision.team:
        return [step["employeeId"] for step in decision.team]
    return [decision.primary.id] if decision.primary else []


# --- compound requests reach everyone they need -------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("message,expected", [
    ("Create an article with a featured image", {"dune", "mirage"}),
    ("Write a blog post and generate a cover image", {"dune", "mirage"}),
    ("Create product photos and the descriptions", {"mirage", "dune"}),
])
async def test_a_compound_request_reaches_every_specialist(message, expected):
    assert expected <= set(await _team(message)), (
        f"{message!r} dropped part of what was asked for")


@pytest.mark.asyncio
async def test_the_reported_bug_the_image_artisan_is_not_skipped():
    """Regression: the featured image used to vanish entirely."""
    team = await _team("Create an article with a featured image")
    assert "mirage" in team
    # And the writer comes first -- the image dresses finished content.
    assert team.index("dune") < team.index("mirage")


# --- precision: a plain request must not conscript the company ----------------


@pytest.mark.asyncio
@pytest.mark.parametrize("message,expected", [
    ("Write a blog article", "dune"),
    ("Write an SEO article about homemade lemonade", "dune"),
    ("Analyze my competitors", "sable"),
    ("Generate Pinterest images", "mirage"),
    ("Create product photos", "mirage"),
    ("Who are my ideal customers?", "oasis"),
    ("I want to contact restaurants", "nomad"),
    ("Generate Instagram content", "sirocco"),
])
async def test_a_single_ask_stays_a_single_specialist(message, expected):
    team = await _team(message)
    assert team == [expected], f"{message!r} over-recruited: {team}"


# --- delivery order -----------------------------------------------------------


def test_capabilities_are_ordered_by_delivery_stage():
    ordered = ai_router.order_capabilities([
        "social.instagram", "content.article", "research.market_report",
        "image.editorial", "seo.opportunity_discovery"])
    assert ordered == ["research.market_report", "seo.opportunity_discovery",
                       "content.article", "image.editorial", "social.instagram"]


def test_ordering_is_stable_and_deduplicates():
    assert ai_router.order_capabilities(
        ["content.article", "content.article"]) == ["content.article"]


def test_team_never_books_the_same_person_twice_for_one_action():
    intent = ai_router.Intent(capabilities=["social.instagram", "social.facebook",
                                            "social.linkedin"])
    team = ai_router.build_team(intent)
    pairs = [(s["employeeId"], s["actionId"]) for s in team]
    assert len(pairs) == len(set(pairs))
    assert len(team) == 1, "one pass by the creative director, not three"


# --- collaboration is decided by the work, not a label ------------------------


def test_two_specialists_means_a_team_regardless_of_any_complexity_flag():
    intent = ai_router.Intent(
        capabilities=["content.article", "image.editorial"], complexity="simple")
    team = ai_router.build_team(intent)
    assert {s["employeeId"] for s in team} == {"dune", "mirage"}


# --- the roster gap that caused the bug ---------------------------------------


def test_editorial_imagery_is_owned_by_the_image_artisan():
    employee, action = registry.resolve_action("image.editorial")
    assert employee is not None and employee.id == "mirage"
    assert action is not None and action.id == "editorial_image"


def test_no_capability_the_router_can_reach_is_unbacked():
    """Every capability that resolves must resolve to a real, runnable action."""
    for employee in registry.all_employees():
        for capability in employee.capabilities:
            resolved, action = registry.resolve_action(capability)
            if resolved is None:
                continue
            assert action is not None
            assert action.skill_key or action.handler


# --- phrase matching ----------------------------------------------------------


def test_plurals_match_their_singular_form():
    from app.employees.spec import _phrase_match
    # Both terms present, one of them pluralised by the user.
    assert _phrase_match("write the product descriptions",
                         ["product description"]) == 1.0
    # And the plural alone still contributes, rather than scoring nothing.
    assert _phrase_match("write the descriptions", ["product description"]) == 0.5


def test_a_multi_word_phrase_that_collapses_to_one_common_word_is_ignored():
    """"x post" tokenises to {post} and would match any message mentioning it."""
    from app.employees.spec import _phrase_match
    assert _phrase_match("write a blog post", ["x post"]) == 0.0
    assert _phrase_match("write a blog post", ["post"]) == 1.0


def test_confidence_is_zero_when_none_of_the_wanted_capabilities_are_covered():
    """Incidental word overlap must not buy a seat outside your field."""
    mirage = registry.get("mirage")
    assert not mirage.covers("content.article")
    assert mirage.confidence_score("write a blog article", ["content.article"]) == 0.0


# --- follow-on suggestions ----------------------------------------------------


def test_next_steps_come_from_the_roster_not_from_hardcoding():
    steps = ai_router.next_steps("dune", ["content.article"])
    assert steps, "the writer should hand on to someone"
    assert all(step["employeeId"] != "dune" for step in steps)
    assert all(step["actionId"] for step in steps)
