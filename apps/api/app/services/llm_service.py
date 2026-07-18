"""LLM provider dispatch: decrypt org keys, call Anthropic/OpenAI/Google."""
import uuid

import httpx
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decrypt_value
from app.models.api_key import APIKey
from app.models.project import Project


async def get_org_llm_keys(org_id: uuid.UUID, db: AsyncSession) -> dict[str, str]:
    """Return {provider: plaintext_key} for every API key stored for the org."""
    result = await db.execute(select(APIKey).where(APIKey.org_id == org_id))
    return {k.provider: decrypt_value(k.encrypted_value) for k in result.scalars().all()}


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


async def call_llm(
    provider: str,
    model: str,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
    locale: str | None = "en",
    max_tokens: int = DEFAULT_MAX_TOKENS,
) -> str:
    """Call the named provider and return the raw text response.

    ``locale`` is the project's language code; when non-English a directive is
    appended to the system prompt so the agent answers in that language.
    """
    system_prompt = system_prompt + language_directive(locale)
    if provider == "anthropic":
        return await _call_anthropic(model, api_key, system_prompt, user_prompt, max_tokens)
    if provider == "openai":
        return await _call_openai(model, api_key, system_prompt, user_prompt, max_tokens)
    if provider == "google":
        return await _call_google(model, api_key, system_prompt, user_prompt)
    raise ValueError(f"Unknown provider: {provider}")


async def _call_anthropic(
    model: str, api_key: str, system_prompt: str, user_prompt: str, max_tokens: int = DEFAULT_MAX_TOKENS
) -> str:
    client = AsyncAnthropic(api_key=api_key)
    message = await client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    return message.content[0].text


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
