"""Small talk must never wake a specialist.

"how are you" reached the Market Researcher at 0.69 confidence, because the
keyword fallback scores phrase overlap against `supported_tasks` and a greeting
brushes against enough words to look like work. The user sees the wrong name
answering a pleasantry, and it costs a model call to get there.
"""
import pytest

from app.employees import registry
from app.employees.router import MODE_ASSISTANT, is_small_talk


class TestDetection:
    @pytest.mark.parametrize("msg", [
        "hello", "Hi!", "hey", "bonjour", "salut", "coucou", "hola",
        "how are you", "ça va", "who are you", "What can you do?",
        "thanks", "merci", "ok", "bye",
    ])
    def test_conversational_messages_are_caught(self, msg):
        assert is_small_talk(msg)

    @pytest.mark.parametrize("msg", [
        "write me an article about running shoes",
        "audit my store",
        "which landing pages earn the most revenue?",
        "how are my rankings doing this month",
        # The trap: a greeting followed by real work is WORK. A loose substring
        # match would swallow the request and answer "hello" instead.
        "hello, write me an article about shoes",
        "hi, can you analyse my competitors",
    ])
    def test_real_work_is_not_caught(self, msg):
        assert not is_small_talk(msg)

    def test_a_long_message_is_work_even_if_it_opens_politely(self):
        assert not is_small_talk("hello " + "x" * 80)


class TestRouting:
    @pytest.mark.parametrize("msg", ["how are you", "who are you", "what can you do?"])
    async def test_no_specialist_is_woken(self, msg):
        class _Ctx:
            tier, locale, keys, dna = "balanced", "en", {}, None
            def available_providers(self):
                return []
        from app.employees.router import route
        decision = await route(msg, _Ctx())
        assert decision.mode == MODE_ASSISTANT
        assert decision.primary is None

    @pytest.mark.parametrize("msg,owner", [
        ("audit my store", "souk"),
    ])
    async def test_real_work_still_reaches_its_specialist(self, msg, owner):
        class _Ctx:
            tier, locale, keys, dna = "balanced", "en", {}, None
            def available_providers(self):
                return []
        from app.employees.router import route
        decision = await route(msg, _Ctx())
        assert decision.mode != MODE_ASSISTANT
        assert decision.primary is not None and decision.primary.id == owner

    def test_the_pleasantry_path_costs_no_router_call(self):
        """Checked before understand(), so a greeting never reaches a model
        just to be classified as a greeting."""
        import inspect
        from app.employees import router
        src = inspect.getsource(router.route)
        assert src.index("is_small_talk") < src.index("await understand")


class TestAssistantReply:
    def test_it_answers_from_the_live_roster(self):
        """A hardcoded blurb drifts the moment an employee is hired."""
        import inspect
        from app.services import employee_chat
        src = inspect.getsource(employee_chat._assistant_reply)
        assert "registry.all_employees()" in src

    def test_a_pleasantry_never_buys_the_expensive_model(self):
        import inspect
        from app.services import employee_chat
        src = inspect.getsource(employee_chat._assistant_reply)
        assert 'resolve_model("economy", "light"' in src


class TestOutOfScope:
    """An empty capability list is an ANSWER, not a failure.

    understand() asked the model to return [] for work the company cannot do,
    the model did, and `if not wanted: return _keyword_intent(...)` threw that
    judgement away -- letting phrase overlap invent a match. "What is the
    weather in Paris" came back as ecommerce.growth_audit and woke Souk, on
    screen, in front of the user.
    """

    def test_an_empty_llm_answer_is_kept_rather_than_re_guessed(self):
        import inspect
        from app.employees import router
        src = inspect.getsource(router.understand)
        # The fallback must be reachable only when the model named capabilities
        # we do not recognise -- a failed answer, not a considered "none".
        assert "if not raw_caps:" in src
        # The guard must sit before the fallback it protects. index() finds the
        # FIRST _keyword_intent -- the no-providers path near the top -- so the
        # comparison has to be against what follows the guard.
        after_guard = src[src.index("if not raw_caps:"):]
        assert "return _keyword_intent(message, known)" in after_guard
        assert after_guard.index('source="llm"') < after_guard.index("_keyword_intent")

    def test_an_unrecognised_answer_still_falls_back_to_keywords(self):
        """A model naming slugs that do not exist HAS failed, and keywords are
        better than nothing there."""
        import inspect
        from app.employees import router
        assert "_keyword_intent(message, known)" in inspect.getsource(router.understand)

    async def test_no_capabilities_routes_to_the_assistant(self):
        from app.employees.router import MODE_ASSISTANT, Intent, route
        from app.employees import router as r

        async def fake_understand(message, ctx, history=None):
            return Intent(capabilities=[], source="llm", summary=message)

        original = r.understand
        r.understand = fake_understand
        try:
            class _Ctx:
                tier, locale, keys, dna = "balanced", "en", {}, None
                def available_providers(self):
                    return ["openai"]
            decision = await route("what is the weather in Paris", _Ctx())
        finally:
            r.understand = original
        assert decision.mode == MODE_ASSISTANT
        assert decision.primary is None
