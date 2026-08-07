"""An image attached to a chat message.

The id arrives from the client and is guessable, so the whole feature turns on
resolving it against the caller's organisation before any prompt reads it --
otherwise a guessed id pulls another organisation's image into your context.
"""
import inspect

from app.services import employee_chat


class TestScoping:
    def test_the_attachment_is_resolved_against_the_conversation_s_org(self):
        src = inspect.getsource(employee_chat._resolve_attachment)
        assert "GeneratedImage.org_id == convo.org_id" in src

    def test_a_missing_or_foreign_image_resolves_to_nothing(self):
        """Returning None rather than raising: a bad id is a client mistake, not
        a reason to fail the user's message."""
        src = inspect.getsource(employee_chat._resolve_attachment)
        assert "return None" in src

    def test_the_request_takes_an_id_not_a_url(self):
        """A URL from the client would be unverifiable -- it could point
        anywhere, including at someone else's storage."""
        from app.api.v1.routers.chat import ChatRequest
        assert "attachment_image_id" in ChatRequest.model_fields
        assert "attachment_url" not in ChatRequest.model_fields


class TestEveryEmployeeSeesIt:
    def test_it_is_put_on_the_context_not_handed_to_one_employee(self):
        """A user who attaches a product photo and asks about revenue should
        not be told to attach the photo they just attached."""
        src = inspect.getsource(employee_chat.run_turn)
        assert 'ctx.runtime["attachment"]' in src

    def test_the_prompt_tells_the_model_it_is_theirs_to_work_from(self):
        src = inspect.getsource(employee_chat._speak)
        assert "THE USER ATTACHED AN IMAGE" in src
        assert "already" in src and "attached" in src
        # Honest about the limit: the model gets the URL, not the pixels.
        # Telling a text model an image is attached without saying so produced
        # "je ne peux pas voir d'images" -- an apology instead of an offer.
        #
        # Asserted on a fragment that survives the source's line wrapping. The
        # first version of this test looked for a phrase that spans a string
        # concatenation, so it could never match getsource() and failed against
        # correct code.
        assert "CANNOT see its" in src
        assert "never apologise for not seeing it" in src

    def test_it_is_recorded_on_the_user_message_so_it_survives_a_reload(self):
        src = inspect.getsource(employee_chat.run_turn)
        assert '"attachment": attachment' in src


class TestMirageUsesIt:
    def test_an_attached_image_outranks_the_catalogue(self):
        """They pointed at a specific photo. Re-scening a different product the
        store happens to list first answers a question nobody asked."""
        from app.services.agents.skills import mirage
        src = inspect.getsource(mirage._persist_shot)
        assert src.index('runtime') < src.index("_source_product_image")
