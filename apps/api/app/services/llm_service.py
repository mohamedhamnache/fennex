"""LLM provider dispatch: decrypt org keys, call Anthropic/OpenAI/Google."""
import logging
import uuid
from dataclasses import dataclass

import httpx
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project

logger = logging.getLogger(__name__)


@dataclass
class LLMUsage:
    provider: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0  # Anthropic cache_creation_input_tokens; billed at
                                 # ~1.25x the input rate (the provider's cache-write premium)
    batch: bool = False  # priced from the batch_* cost_rates units (50% off)


async def get_org_llm_keys(org_id: uuid.UUID, db: AsyncSession) -> dict[str, str]:
    """Return {provider: plaintext_key} for LLM calls. Platform accounts/env by
    default; a tenant's own keys override only when the org has byok_enabled.

    Also records this org as the ambient metering target: every LLM call is
    preceded by a key lookup, so `call_llm` can attribute usage to `org_id`
    without each caller threading a meter through."""
    from app.services.providers import registry
    from app.core.metering_context import set_metering_org
    set_metering_org(org_id)
    return await registry.get_llm_keys(org_id, db)


async def project_locale(project_id, db: AsyncSession) -> str:
    """Return a project's language code (``locale``), defaulting to English."""
    if project_id is None:
        return "en"
    project = await db.get(Project, project_id)
    return (project.locale if project and project.locale else "en")


# Common project locale codes mapped to English language names for a natural
# directive. Anything unmapped falls back to instructing by the ISO code itself.
_LANGUAGE_NAMES = {
    "fr": "French", "es": "Spanish", "de": "German", "it": "Italian",
    "pt": "Portuguese", "nl": "Dutch", "ar": "Arabic", "ru": "Russian",
    "zh": "Chinese", "ja": "Japanese", "ko": "Korean", "hi": "Hindi",
    "tr": "Turkish", "pl": "Polish", "sv": "Swedish", "da": "Danish",
    "no": "Norwegian", "fi": "Finnish", "cs": "Czech", "el": "Greek",
    "he": "Hebrew", "id": "Indonesian", "th": "Thai", "vi": "Vietnamese",
    "uk": "Ukrainian", "ro": "Romanian", "hu": "Hungarian", "en": "English",
}


def language_directive(locale: str | None) -> str:
    """Directive telling the model to answer in the project's language.

    Meant to be prepended to the *user* prompt (see ``call_llm_usage``), not
    appended to the system prompt: a per-locale suffix on the system prompt
    would make the cacheable prefix differ for every locale, so nothing
    would ever cache-hit.

    Returns "" for English (the default) so existing behaviour is unchanged.
    Structure-preserving: only human-readable string values are translated;
    JSON keys and enum/constant values are kept verbatim so machine parsing of
    structured responses is not broken.
    """
    code = (locale or "en").split("-")[0].lower()
    if code == "en":
        return ""
    lang = _LANGUAGE_NAMES.get(code) or f"the language with ISO code '{code}'"
    return (
        f"\n\nIMPORTANT: Write all human-readable text in your response in {lang}. "
        "If your response is JSON or another structured format, translate only the "
        "human-readable string values — keep every field name, key, and enum or "
        "constant value exactly as specified (do not translate or rename them)."
    )


# Long-form articles need a high output budget or they get truncated (which
# drops the FAQ/conclusion and guts SEO). Chat/transform stay at the default.
DEFAULT_MAX_TOKENS = 4096
ARTICLE_MAX_TOKENS = 8192

# Anthropic bills a cache write at ~1.25x and a cache read at ~0.1x, so marking
# a prefix below the provider's minimum cacheable length only pays the write
# premium and never actually caches -- it fails silently too, surfacing as
# cache_creation_input_tokens: 0 rather than an error, so a too-low threshold
# looks fine in testing and just quietly burns money in production.
#
# Anthropic's documented per-model minimums (as of this writing): Opus 5 --
# 512 tokens; Sonnet 5 -- 1024 tokens; Haiku 3.5 / Opus 4.7 -- 2048 tokens;
# Haiku 4.5 -- 4096 tokens. This constant marks system prompts for every
# Anthropic model we route to (see app/services/providers/catalog.py's SEED),
# and claude-haiku-4-5 is the cheap-band row in that rotation -- so its 4096
# token minimum is the one that governs: the threshold must clear the LARGEST
# minimum among models actually in rotation, not the smallest, because a
# prefix that clears Sonnet/Opus's lower minimum but not Haiku's still
# mark-and-never-caches on Haiku calls. At ~4 chars/token that's ~16000 chars.
#
# IMPORTANT: this minimum is NOT monotonic across model generations (Opus 5 is
# lower than Opus 4.6/4.5, e.g.) -- it dropped, in this codebase's history, to
# a value below Haiku 4.5's actual minimum more than once. Never lower this
# constant without re-checking the documented minimum for every model in
# catalog.py's SEED, and re-deriving the max across all of them.
CACHEABLE_MIN_CHARS = 16000


def _anthropic_system_blocks(system_prompt: str):
    """Mark a long, stable system prefix as cacheable. Anything shorter is sent
    unchanged. OpenAI needs no equivalent: its caching is automatic once the
    stable content leads the prompt."""
    if len(system_prompt) < CACHEABLE_MIN_CHARS:
        return system_prompt
    return [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]


async def call_llm(
    provider: str,
    model: str,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    locale: str | None = "en",
    max_tokens: int | None = None,
    meter: dict | None = None,
    feature: str | None = None,
) -> str:
    """Call the named provider and return the raw text response.

    ``locale`` is the project's language code; when non-English a directive is
    prepended to the *user* prompt so the agent answers in that language. It
    goes on the user prompt rather than the system prompt so the system
    prefix stays byte-identical across locales — a per-locale suffix there
    would make the prefix differ per locale and defeat Anthropic prompt
    caching for every non-English request.

    ``feature`` names the calling feature. It supplies the output-token ceiling
    from the routing policy when the caller passes no explicit ``max_tokens``
    (output costs ~5x input, so an unbounded cap is a direct margin leak), and
    it is the key the usage meter reports against.

    When `meter` is given ({'db','org_id','project_id','feature'}), record
    token usage/cost after the call. Metering failures never break the call.
    """
    if max_tokens is None:
        from app.services.agents.policy import policy_for
        max_tokens = policy_for(feature).max_output_tokens if feature else DEFAULT_MAX_TOKENS
    text, usage = await call_llm_usage(provider, model, api_key, system_prompt,
                                       user_prompt, locale=locale, max_tokens=max_tokens)
    if meter is not None:
        try:
            from app.services.metering import meter as _m
            await _m.record_llm(meter["db"], org_id=meter["org_id"],
                                project_id=meter.get("project_id"),
                                usage=usage, feature=meter.get("feature") or feature)
        except Exception:
            logger.exception("usage metering failed (non-fatal)")
    else:
        # Ambient metering: capture EVERY LLM call (requests and workers alike)
        # against the org whose keys were resolved for it. Uses a fresh isolated
        # session so the meter's own commit never touches a caller transaction;
        # best-effort, never breaks the call.
        from app.core.metering_context import get_metering_org
        org_id = get_metering_org()
        if org_id is not None:
            try:
                from app.core.database import async_session_factory
                from app.services.metering import meter as _m
                async with async_session_factory() as mdb:
                    await _m.record_llm(mdb, org_id=org_id, project_id=None,
                                        usage=usage, feature=feature)
            except Exception:
                logger.exception("ambient usage metering failed (non-fatal)")
    return text


async def _call_anthropic(
    model: str, api_key: str, system_prompt: str, user_prompt: str, max_tokens: int = DEFAULT_MAX_TOKENS
) -> str:
    client = AsyncAnthropic(api_key=api_key)
    message = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=_anthropic_system_blocks(system_prompt),
        messages=[{"role": "user", "content": user_prompt}],
    )
    return message.content[0].text


async def _openai_usage(model, api_key, system_prompt, user_prompt, max_tokens):
    client = AsyncOpenAI(api_key=api_key)
    resp = await client.chat.completions.create(
        model=model,
        messages=[{"role": "system", "content": system_prompt},
                  {"role": "user", "content": user_prompt}],
        max_tokens=max_tokens,
    )
    u = getattr(resp, "usage", None)
    cached = 0
    details = getattr(u, "prompt_tokens_details", None) if u else None
    if details is not None:
        cached = getattr(details, "cached_tokens", 0) or 0
    usage = LLMUsage("openai", model,
                     input_tokens=getattr(u, "prompt_tokens", 0) or 0,
                     output_tokens=getattr(u, "completion_tokens", 0) or 0,
                     cache_read_tokens=cached)
    return resp.choices[0].message.content, usage


async def _anthropic_usage(model, api_key, system_prompt, user_prompt, max_tokens):
    client = AsyncAnthropic(api_key=api_key)
    message = await client.messages.create(
        model=model, max_tokens=max_tokens, system=_anthropic_system_blocks(system_prompt),
        messages=[{"role": "user", "content": user_prompt}],
    )
    u = getattr(message, "usage", None)
    usage = LLMUsage("anthropic", model,
                     input_tokens=getattr(u, "input_tokens", 0) or 0,
                     output_tokens=getattr(u, "output_tokens", 0) or 0,
                     cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0,
                     cache_write_tokens=getattr(u, "cache_creation_input_tokens", 0) or 0)
    return message.content[0].text, usage


async def call_llm_usage(
    provider: str, model: str, api_key: str, system_prompt: str, user_prompt: str,
    locale: str | None = "en", max_tokens: int = DEFAULT_MAX_TOKENS,
) -> tuple[str, "LLMUsage"]:
    """Like call_llm but also returns an LLMUsage (token counts)."""
    directive = language_directive(locale)
    if directive:
        user_prompt = directive.strip() + "\n\n" + user_prompt
    from app.services.batch import client as _batch_client
    from app.services.batch.scope import batch_enabled
    if batch_enabled() and provider in _batch_client.SUPPORTED_PROVIDERS:
        result = await _batch_client.run_batched(provider, model, api_key, system_prompt,
                                                 user_prompt, max_tokens)
        if result is not None:
            return result
    if provider == "anthropic":
        return await _anthropic_usage(model, api_key, system_prompt, user_prompt, max_tokens)
    if provider == "openai":
        return await _openai_usage(model, api_key, system_prompt, user_prompt, max_tokens)
    if provider == "google":
        return await _google_usage(model, api_key, system_prompt, user_prompt)
    raise ValueError(f"Unknown provider: {provider}")


async def stream_llm(
    provider: str,
    model: str,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    locale: str | None = "en",
    max_tokens: int = DEFAULT_MAX_TOKENS,
):
    """Stream the provider's response as text chunks (async generator).

    Anthropic and OpenAI stream token deltas; Google degrades to a single
    chunk (its REST streaming needs a different wire format).

    ``locale`` is treated the same way ``call_llm_usage`` treats it: the
    directive is prepended to the *user* prompt, not appended to the system
    prompt, so the system prefix stays byte-identical across locales and can
    still cache-hit on Anthropic.
    """
    directive = language_directive(locale)
    if directive:
        user_prompt = directive.strip() + "\n\n" + user_prompt
    if provider == "anthropic":
        client = AsyncAnthropic(api_key=api_key)
        async with client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            system=_anthropic_system_blocks(system_prompt),
            messages=[{"role": "user", "content": user_prompt}],
        ) as stream:
            async for text in stream.text_stream:
                yield text
    elif provider == "openai":
        client = AsyncOpenAI(api_key=api_key)
        response = await client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=max_tokens,
            stream=True,
        )
        async for chunk in response:
            delta = chunk.choices[0].delta.content if chunk.choices else None
            if delta:
                yield delta
    elif provider == "google":
        yield await _call_google(model, api_key, system_prompt, user_prompt)
    else:
        raise ValueError(f"Unknown provider: {provider}")


async def _call_openai(
    model: str, api_key: str, system_prompt: str, user_prompt: str, max_tokens: int = DEFAULT_MAX_TOKENS
) -> str:
    client = AsyncOpenAI(api_key=api_key)
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content


async def _google_usage(model: str, api_key: str, system_prompt: str,
                        user_prompt: str) -> tuple[str, "LLMUsage"]:
    """Call Gemini and report its real token usage.

    The response carries `usageMetadata` with prompt and candidate token counts.
    Not reading it meant every Google call metered as ZERO tokens and therefore
    billed nothing -- a paid supplier call charged to no one, on whichever
    features route to Gemini.
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            url,
            params={"key": api_key},
            json={
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"parts": [{"text": user_prompt}]}],
            },
        )
        resp.raise_for_status()
        data = resp.json()

    text = data["candidates"][0]["content"]["parts"][0]["text"]
    um = data.get("usageMetadata") or {}
    # candidatesTokenCount is absent on some responses; totalTokenCount minus the
    # prompt is the documented fallback.
    prompt_tokens = int(um.get("promptTokenCount") or 0)
    output_tokens = int(um.get("candidatesTokenCount") or 0)
    if not output_tokens and um.get("totalTokenCount"):
        output_tokens = max(0, int(um["totalTokenCount"]) - prompt_tokens)
    return text, LLMUsage("google", model, prompt_tokens, output_tokens)


async def _call_google(model: str, api_key: str, system_prompt: str, user_prompt: str) -> str:
    text, _ = await _google_usage(model, api_key, system_prompt, user_prompt)
    return text
