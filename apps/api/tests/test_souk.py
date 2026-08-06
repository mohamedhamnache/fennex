"""Souk -- the ecommerce operator -- and the guard that keeps its advice honest.

The dashboard mixes measured figures with placeholders. An agent that cannot
tell them apart will tell a merchant to cut ad spend on the strength of an
invented ROAS, and the merchant will do it. Most of this file defends the one
property that prevents that: a metric nobody measured reaches the model with no
value at all.
"""
import inspect
import uuid

import pytest

from app.employees import registry, toolbelt
from app.employees import capabilities as caps
from app.services.agents.registry import get_skill
from app.services.agents.brief import Brief
from app.services.agents.skills import souk as skills


def _brief() -> Brief:
    """The real Brief, not a stub -- a stub drifts from the type the skills are
    actually handed, and then the test exercises a prompt nobody builds."""
    return Brief(goal="grow revenue", persona="ecommerce", project_id=uuid.uuid4(),
                 org_id=uuid.uuid4(), locale="en", project_profile="", brand={},
                 existing_content=[])


class TestHired:
    def test_souk_is_on_the_roster(self):
        e = registry.get("souk")
        assert e is not None
        assert e.role == "Ecommerce Growth Operator"
        assert e.department == "Growth"

    def test_every_action_resolves_to_a_real_skill(self):
        """An action whose skill_key does not resolve fails at run time, in
        front of the user, with the credits already spent on getting there."""
        for a in registry.get("souk").actions:
            assert get_skill(a.skill_key) is not None, f"{a.id} -> {a.skill_key} missing"

    def test_every_tool_it_asks_for_exists(self):
        assert toolbelt.missing(registry.get("souk").allowed_tools) == []

    def test_every_capability_is_in_the_taxonomy(self):
        """The Orchestrator assembles teams by capability. One that is not in
        the taxonomy can never be matched, so the employee is unreachable."""
        assert caps.unknown(registry.get("souk").capabilities) == []

    def test_the_store_analytics_tool_is_gated_on_a_connected_store(self):
        """Without an availability check the tool is offered to every project,
        and an agent calls it on a store that does not exist."""
        tool = toolbelt.get_tool("shopify.analytics")
        assert tool is not None
        assert tool.app == "shopify"
        assert tool.availability is not None


class TestRouting:
    """The Router ranks on confidence and never on names."""

    @pytest.mark.parametrize("message,capability", [
        ("why are sales down this month", "ecommerce.growth_audit"),
        ("how do I reduce cart abandonment", "ecommerce.cro_review"),
        ("which products should I push", "ecommerce.merchandising"),
        ("increase repeat purchase rate", "ecommerce.retention_plan"),
    ])
    def test_ecommerce_questions_reach_souk(self, message, capability):
        best = max(registry.all_employees(),
                   key=lambda e: e.confidence_score(message, [capability]))
        assert best.id == "souk"

    @pytest.mark.parametrize("message,capability,owner", [
        ("what should I write about", "seo.opportunity_discovery", "zerda"),
        ("write me an article", "content.article", "dune"),
    ])
    def test_souk_does_not_poach_other_specialists(self, message, capability, owner):
        """A new employee with broad-sounding expertise must not start winning
        work that already has an owner."""
        best = max(registry.all_employees(),
                   key=lambda e: e.confidence_score(message, [capability]))
        assert best.id == owner
        assert registry.get("souk").confidence_score(message, [capability]) == 0.0

    def test_store_analysis_is_sequenced_before_content(self):
        """In a compound request the store's numbers must inform what gets
        written, not arrive after it."""
        from app.employees.router import order_capabilities
        ordered = order_capabilities(["content.article", "ecommerce.growth_audit"])
        assert ordered.index("ecommerce.growth_audit") < ordered.index("content.article")


class TestNeverInventsANumber:
    """The safety property. Each test names the harm it prevents."""

    def _td(self, **over):
        data = {"currency": "EUR",
                "window": {"days": 30, "from": "2026-07-08", "to": "2026-08-06"},
                "measured": {"revenue": {"value": "6,229.17 EUR", "change_pct": 12.0,
                                         "previous": "5,561.00 EUR"}},
                "unavailable": [{"metric": "roas", "needs": "Meta or Google Ads"}],
                "unavailable_dimensions": ["product", "country"],
                "revenue_by": {}, "daily_revenue": [], "observations": [],
                "content_revenue": {}}
        data.update(over)
        return {"shopify.analytics": {"data": data}}

    def test_an_unmeasured_metric_reaches_the_model_without_a_value(self):
        """The core guarantee. A caveat is a sentence the model can drop; a
        missing number is not there to be quoted."""
        block = skills._store_block(self._td())
        assert "roas" in block
        assert "NOT MEASURED" in block
        assert "Meta or Google Ads" in block
        # No digits anywhere on the roas line.
        roas_line = next(l for l in block.splitlines() if "roas" in l)
        assert not any(ch.isdigit() for ch in roas_line)

    def test_measured_and_unmeasured_are_in_separate_labelled_blocks(self):
        block = skills._store_block(self._td())
        assert block.index("MEASURED:") < block.index("NOT MEASURED")

    def test_a_figure_with_no_previous_period_is_marked_not_zero(self):
        """Rendering a missing comparison as 0% tells the merchant nothing
        changed, when the truth is that nothing is known."""
        block = skills._store_block(self._td(measured={
            "revenue": {"value": "100.00 EUR", "change_pct": None, "previous": None}}))
        assert "no comparable previous period" in block
        assert "0.0%" not in block

    def test_a_store_with_no_data_says_so_instead_of_rendering_blanks(self):
        block = skills._store_block({})
        assert "unavailable" in block.lower()
        assert "no store is connected" in block

    @pytest.mark.parametrize("build", [
        skills._growth_audit_prompt, skills._cro_review_prompt,
        skills._retention_prompt, skills._merchandising_prompt,
    ])
    def test_every_prompt_carries_the_no_invention_rule(self, build):
        """Stated per-prompt, not once in the employee's system prompt: the
        tool result and the rule end up adjacent in the context, which is where
        the temptation to fill a blank actually arises."""
        system, _ = build(_brief(), {}, self._td())
        assert "never estimate" in system.lower()
        assert "NOT MEASURED" in system

    @pytest.mark.parametrize("build", [
        skills._growth_audit_prompt, skills._cro_review_prompt,
        skills._retention_prompt, skills._merchandising_prompt,
    ])
    def test_every_prompt_asks_for_the_gaps_to_be_named(self, build):
        """Saying "I cannot see your conversion rate, connect X" is more useful
        than a guess -- and is what stops the model filling the gap silently."""
        system, _ = build(_brief(), {}, self._td())
        low = system.lower()
        assert "blind_spots" in low or "cannot_see" in low


class TestContextBuilder:
    def test_the_builder_is_scoped_to_an_organisation(self):
        from app.services import store_agent_context
        params = inspect.signature(store_agent_context.build).parameters
        assert "org_id" in params
        assert params["org_id"].default is inspect.Parameter.empty

    def test_sample_breakdowns_never_reach_the_agent(self):
        """A "revenue by product" split the orders sync cannot see would
        otherwise become a merchandising recommendation."""
        src = inspect.getsource(__import__(
            "app.services.store_agent_context", fromlist=["x"]).build)
        assert 'block["source"] == "live"' in src

    def test_sample_insights_are_dropped_rather_than_labelled(self):
        from app.services import store_agent_context
        src = inspect.getsource(store_agent_context.build)
        assert 'i["source"] == "live"' in src
