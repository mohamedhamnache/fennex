"""POST /images/interpret-attachment.

Decides whether an image attached to a Mirage message is an element to INSERT
or a look to use as a REFERENCE, and describes it, in one metered vision call.

The classification will sometimes be wrong and the failure is asymmetric -- a
reference treated as an insert stamps an unwanted picture into the frame, an
insert treated as a reference silently drops what was asked for -- so what is
pinned here is not accuracy (only a human can judge that) but the properties
that make a wrong verdict survivable and honestly priced:

  * one vision call, never two, and the description comes back for BOTH
    verdicts so a correction costs nothing;
  * the call is metered against the calling org under its own feature name;
  * no vision key is never a hard failure, because the user has already
    uploaded the image and is waiting on a reply.
"""
import json
import uuid

import pytest

from app.api.v1.routers import images as images_router
from app.core import metering_context
from app.services import llm_service


class _Usage:
    provider = "anthropic"
    model = "claude-haiku-4-5-20251001"
    input_tokens = 1800
    output_tokens = 240
    cache_read_tokens = 0
    cache_write_tokens = 0
    batch = False


class _Attachment:
    def __init__(self, url="https://storage.example/user-uploads/logo.png"):
        self.image_url = url


class _FakeDB:
    """Just enough of an AsyncSession for the router's single lookup."""

    def __init__(self, attachment):
        self._attachment = attachment

    async def execute(self, _stmt):
        attachment = self._attachment

        class _Result:
            @staticmethod
            def scalar_one_or_none():
                return attachment

        return _Result()


class _User:
    def __init__(self, org_id):
        self.org_id = org_id


@pytest.fixture
def harness(monkeypatch):
    """Stub the provider call, the download and the meter; report what each saw."""
    state: dict = {"vision_calls": 0, "text_calls": 0, "reply": None}

    async def fake_vision_usage(provider, model, api_key, system_prompt, user_prompt,
                                image_bytes, media_type="image/png",
                                max_tokens=llm_service.DEFAULT_MAX_TOKENS):
        state["vision_calls"] += 1
        state["system"] = system_prompt
        state["user"] = user_prompt
        state["image_bytes"] = image_bytes
        state["media_type"] = media_type
        state["max_tokens"] = max_tokens
        return state["reply"], _Usage()

    async def fake_call_llm_usage(*a, **kw):
        state["text_calls"] += 1
        raise AssertionError("interpret-attachment must not make a second, text-only call")

    monkeypatch.setattr(llm_service, "call_llm_vision_usage", fake_vision_usage)
    monkeypatch.setattr(llm_service, "call_llm_usage", fake_call_llm_usage)

    async def fake_download(url):
        state["downloaded"] = url
        return b"\x89PNG-bytes"

    import app.services.image_output as image_output
    monkeypatch.setattr(image_output, "_download", fake_download)

    async def fake_get_llm_keys(org_id, db):
        return dict(state.get("keys", {"anthropic": "sk-test"}))

    from app.services.providers import registry
    monkeypatch.setattr(registry, "get_llm_keys", fake_get_llm_keys)

    async def fake_record_llm(db, *, org_id, project_id, usage, feature=None):
        state["metered_org"] = org_id
        state["metered_feature"] = feature
        return 0

    # Patch the FUNCTION on the real module, not the module in sys.modules:
    # `from app.services.metering import meter` resolves the already-bound
    # package attribute, which a sys.modules substitution never reaches.
    from app.services.metering import meter as real_meter
    monkeypatch.setattr(real_meter, "record_llm", fake_record_llm)

    class _NullSession:
        async def __aenter__(self):
            return None

        async def __aexit__(self, *exc):
            return False

    import app.core.database as database
    monkeypatch.setattr(database, "async_session_factory", lambda: _NullSession())
    return state


_DEFAULT_ATTACHMENT = object()


async def _interpret(harness, command, *, org_id=None, attachment=_DEFAULT_ATTACHMENT):
    org_id = org_id or uuid.uuid4()
    metering_context.set_metering_org(None)
    body = images_router.InterpretAttachmentRequest(
        command=command, attachment_image_id=uuid.uuid4(),
    )
    db = _FakeDB(_Attachment() if attachment is _DEFAULT_ATTACHMENT else attachment)
    return await images_router.interpret_attachment(body, _User(org_id), db, None), org_id


async def test_insert_verdict_still_returns_a_description(harness):
    """One call, both artifacts. The description is fetched even for "insert",
    where nothing reads it, so flipping the verdict to "reference" afterwards
    needs no second call and no re-upload."""
    harness["reply"] = json.dumps({
        "intent": "insert",
        "description": "A flat white wordmark on a transparent background.",
    })
    out, _ = await _interpret(harness, "add this logo to the bottle")

    assert out.intent == "insert"
    assert out.description  # present despite the verdict not needing it
    assert out.guessed is False
    assert harness["vision_calls"] == 1
    assert harness["text_calls"] == 0


async def test_reference_verdict(harness):
    harness["reply"] = json.dumps({
        "intent": "reference",
        "description": "A warm sunset gradient over a blurred city skyline.",
    })
    out, _ = await _interpret(harness, "make the background look like this")

    assert out.intent == "reference"
    assert "sunset" in out.description
    assert harness["vision_calls"] == 1


async def test_the_vision_call_is_metered_against_the_org_under_its_own_feature(harness):
    """A vision call is the expensive turn -- an image is worth well over a
    thousand input tokens. An unnamed event in the ledger cannot be told apart
    from any other LLM call the org made."""
    harness["reply"] = json.dumps({"intent": "reference", "description": "x"})
    _, org = await _interpret(harness, "like this")

    assert harness["metered_org"] == org
    assert harness["metered_feature"] == "attachment_intent"


async def test_output_ceiling_comes_from_the_feature_policy(harness):
    from app.services.agents.policy import policy_for

    harness["reply"] = json.dumps({"intent": "reference", "description": "x"})
    await _interpret(harness, "like this")
    assert harness["max_tokens"] == policy_for("attachment_intent").max_output_tokens == 512


async def test_the_image_is_sent_as_bytes_not_as_a_url(harness):
    """Our storage URLs are not necessarily reachable from a provider's
    network, and a silent fetch failure there looks exactly like a bad answer."""
    harness["reply"] = json.dumps({"intent": "insert", "description": "x"})
    await _interpret(harness, "add this")
    assert harness["image_bytes"] == b"\x89PNG-bytes"
    assert harness["downloaded"] == "https://storage.example/user-uploads/logo.png"


async def test_jpeg_attachments_declare_their_own_media_type(harness):
    harness["reply"] = json.dumps({"intent": "insert", "description": "x"})
    await _interpret(harness, "add this",
                     attachment=_Attachment("https://storage.example/u/shot.JPG"))
    assert harness["media_type"] == "image/jpeg"


async def test_a_fenced_json_reply_is_still_parsed(harness):
    """Models fence JSON despite being told not to; a parse failure here would
    fall through to the crude wording heuristic for no reason."""
    harness["reply"] = (
        '```json\n{"intent": "reference", "description": "Muted pastel studio light."}\n```'
    )
    out, _ = await _interpret(harness, "in this style")
    assert out.intent == "reference"
    assert out.description == "Muted pastel studio light."


async def test_an_unparseable_reply_falls_back_instead_of_failing(harness):
    harness["reply"] = "I think you want to add the logo."
    out, _ = await _interpret(harness, "add this logo to the bottle")
    assert out.intent == "insert"
    assert out.guessed is True


async def test_no_vision_key_is_not_a_hard_failure(harness):
    """The user has already uploaded the image and is waiting on a reply."""
    harness["keys"] = {}
    out, _ = await _interpret(harness, "add this logo to the bottle")
    assert out.intent == "insert"
    assert out.guessed is True
    assert harness["vision_calls"] == 0


async def test_the_keyless_fallback_defaults_to_reference(harness):
    """With no model to ask, "reference" is the safer default: a wrong
    reference produces a slightly-off edit the user can see and correct, while
    a wrong insert stamps an unwanted image into their picture."""
    harness["keys"] = {}
    out, _ = await _interpret(harness, "je veux quelque chose comme ceci")
    assert out.intent == "reference"


@pytest.mark.parametrize("command", [
    "add this logo to the bottle",
    "ajoute ce logo en bas",
    "coloca este logo en la esquina",
    "füge dieses Logo hinzu",
    "adicione este logo",
])
def test_insert_wording_is_recognised_without_a_model(command):
    assert images_router._classify_from_command(command) == "insert"


@pytest.mark.parametrize("command", [
    "make the background look like this",
    "dans ce style",
    "similar a esto",
    "im Stil von diesem Bild",
])
def test_reference_wording_is_recognised_without_a_model(command):
    assert images_router._classify_from_command(command) == "reference"


async def test_an_attachment_from_another_org_is_not_found(harness):
    """The row is looked up scoped to the caller's org, which is also why the
    request carries an id rather than a URL -- there is no client-supplied URL
    to fetch and therefore nothing to guard against request forgery."""
    from fastapi import HTTPException

    harness["reply"] = json.dumps({"intent": "insert", "description": "x"})
    with pytest.raises(HTTPException) as exc:
        await _interpret(harness, "add this", attachment=None)
    assert exc.value.status_code == 404
