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


async def get_org_llm_keys(org_id: uuid.UUID, db: AsyncSession) -> dict[str, str]:
    """Return {provider: plaintext_key} for LLM calls. Platform accounts/env by
    default; a tenant's own keys override only when the org has byok_enabled."""
    from app.services.providers import registry
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
    """System-prompt suffix telling the model to answer in the project's language.

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
# a short prefix costs more than it saves. This threshold is a conservative
# character-count proxy for the provider's minimum cacheable prompt length.
CACHEABLE_MIN_CHARS = 4000


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
    appended to the system prompt so the agent answers in that language.

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
                     cache_read_tokens=getattr(u, "cache_read_input_tokens", 0) or 0)
    return message.content[0].text, usage


async def call_llm_usage(
    provider: str, model: str, api_key: str, system_prompt: str, user_prompt: str,
    locale: str | None = "en", max_tokens: int = DEFAULT_MAX_TOKENS,
) -> tuple[str, "LLMUsage"]:
    """Like call_llm but also returns an LLMUsage (token counts). google has no
    reliable token usage in the current call shape -> zeros."""
    directive = language_directive(locale)
    if directive:
        user_prompt = directive.strip() + "\n\n" + user_prompt
    if provider == "anthropic":
        return await _anthropic_usage(model, api_key, system_prompt, user_prompt, max_tokens)
    if provider == "openai":
        return await _openai_usage(model, api_key, system_prompt, user_prompt, max_tokens)
    if provider == "google":
        text = await _call_google(model, api_key, system_prompt, user_prompt)
        return text, LLMUsage("google", model)
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
    """
    system_prompt = system_prompt + language_directive(locale)
    if provider == "anthropic":
        client = AsyncAnthropic(api_key=api_key)
        async with client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            system=system_prompt,
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


async def _call_google(model: str, api_key: str, system_prompt: str, user_prompt: str) -> str:
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
        return data["candidates"][0]["content"]["parts"][0]["text"]
