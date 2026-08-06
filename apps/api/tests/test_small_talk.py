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
