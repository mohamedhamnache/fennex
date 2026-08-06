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

    def test_the_store_tool_resolves_in_the_registry_THE_RUNNER_USES(self):
        """The bug this file exists to prevent a repeat of.

        There are two tool registries: the legacy TOOLS dict that AgentRunner
        drives skills through, and the newer toolbelt the agentic runtime uses.
        store_analytics was registered only in the toolbelt, so every skill run
        resolved nothing -- and run_tools swallows an unknown name, returning
        {"ok": False, "data": None} with no error. Souk then told a merchant
        with 48 synced orders that no store was connected.

        Asserting BOTH registries is the point; either alone passes the bug.
        """
        from app.services.agents.tools import TOOLS as LEGACY
        assert "store_analytics" in LEGACY
        assert toolbelt.get_tool("store_analytics") is not None


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
        return {"store_analytics": {"data": data}}

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

    def test_an_unloaded_store_tells_the_model_to_fetch_before_concluding(self):
        """An empty payload means two different things on the two execution
        paths. The skill runner pre-fetches, so empty really is "no store". The
        agentic runtime passes {} on purpose and expects the model to call the
        tool itself -- and reading that as "no store" made Souk report a
        connected store with 51 orders as empty, in the UI, to the user.

        The message must therefore instruct a fetch first and permit the
        "no store" conclusion only from an actual empty result.
        """
        block = skills._store_block({})
        assert "CALL IT NOW" in block
        assert "Only if you have already called it" in block
        # It must still reach the honest conclusion when there genuinely is none.
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


class TestNoSkillDeclaresAToolThatCannotResolve:
    """The general case of the bug above, for the whole skill catalogue.

    run_tools fails silently on an unknown name, so a typo or a tool registered
    in the wrong place produces an agent that reasons from nothing and says so
    confidently. Nothing else in the suite would notice.
    """

    def test_every_skill_tool_exists_in_the_legacy_registry(self):
        from app.services.agents.registry import SKILLS
        from app.services.agents.tools import TOOLS as LEGACY
        broken = {k: [t for t in (s.tools or []) if t not in LEGACY]
                  for k, s in SKILLS.items()}
        broken = {k: v for k, v in broken.items() if v}
        assert not broken, f"skills declaring unresolvable tools: {broken}"

    def test_every_employee_allowed_tool_exists_in_the_toolbelt(self):
        for e in registry.all_employees():
            assert toolbelt.missing(e.allowed_tools) == [], \
                f"{e.id} allows tools that do not exist: {toolbelt.missing(e.allowed_tools)}"


class TestUnknownIsNotDirect:
    """Found by running the agent, twice.

    Every seeded order lacked a referrer, so the split read "Direct: 100%".
    The agent called that over-reliance on direct traffic and recommended
    buying ads -- a real budget decision taken on missing data.

    The first fix was a >=99.5% threshold in the context builder. A single
    genuine referral then dropped the rest to 99.3%, the guard stopped firing,
    and the agent said "99% direct" again. A share cannot carry the ambiguity;
    only the label can, because in this classifier "Direct" IS "no referrer
    recorded".
    """

    def test_a_missing_referrer_is_never_called_direct(self):
        from app.services.store_analytics import classify_referrer
        assert classify_referrer(None, None) == "Direct or unattributed"
        assert classify_referrer("", "https://shop.com/p") == "Direct or unattributed"

    def test_a_real_referrer_still_classifies_normally(self):
        from app.services.store_analytics import classify_referrer
        assert classify_referrer("https://www.google.com/", None) == "Organic search"
        assert classify_referrer("https://t.co/x", None) == "Social"
        assert classify_referrer("https://blog.example/", None) == "Referral"

    def test_the_ambiguity_survives_at_any_share(self):
        """The bug the threshold could not cover: one genuine referral must not
        make the remaining unattributed orders read as measured direct traffic."""
        from app.services.store_analytics import classify_referrer
        labels = [classify_referrer(None, None) for _ in range(99)]
        labels.append(classify_referrer("https://www.google.com/", None))
        assert labels.count("Direct or unattributed") == 99
        assert "Direct" not in set(labels)          # never the bare, asserting word


class TestNeverInventsAnEntity:
    """The second fabrication class, found the same way -- by running it.

    The metric guard covers figures. It said nothing about ENTITIES, and with
    an empty catalogue a live run recommended pushing "Le café" (an article
    title lifted from the content block), bundling it with "French Biscotti"
    (invented outright), and pricing the bundle at "$140 against $155
    individual" (invented prices for invented products). A merchant would go
    looking for those in their Shopify admin and find nothing.

    An absent list invites the model to supply one, exactly as an absent
    number did.
    """

    def test_an_empty_catalogue_forbids_naming_a_product(self):
        block = skills._products_block({})
        assert "CALL IT before" in block          # fetch first on the agentic path
        assert "must not name, invent or price a product" in block

    def test_an_empty_catalogue_is_never_silent(self):
        """Returning "" was the bug: it left no trace in the prompt at all, so
        the model had no way to know the list was missing rather than empty."""
        assert skills._products_block({}).strip() != ""
        assert skills._products_block({"store_products": {"data": {"products": []}}}).strip() != ""

    def test_a_real_catalogue_is_marked_exhaustive(self):
        block = skills._products_block(
            {"store_products": {"data": {"products": [{"title": "Café Grand Cru", "price": "18.00"}]}}})
        assert "Café Grand Cru" in block
        assert "ONLY products that exist" in block

    def test_articles_are_labelled_as_not_products(self):
        """The model took an article title straight out of the content block and
        merchandised it."""
        td = {"store_analytics": {"data": {
            "currency": "EUR", "window": {"days": 30, "from": "a", "to": "b"},
            "measured": {}, "unavailable": [], "unavailable_dimensions": [],
            "revenue_by": {}, "daily_revenue": [], "observations": [],
            "content_revenue": {"revenue": 100.0, "share_pct": 50.0,
                                "pages": [{"title": "Le café", "path": "/blog/le-cafe",
                                           "orders": 3, "revenue": 100.0}]}}}}
        block = skills._store_block(td)
        assert "NOT products" in block

    def test_the_merchandising_prompt_pins_products_to_the_catalogue(self):
        system, _ = skills._merchandising_prompt(_brief(), {}, {})
        assert "MUST APPEAR IN THE CATALOGUE" in system
        assert "An article title is not a product" in system
