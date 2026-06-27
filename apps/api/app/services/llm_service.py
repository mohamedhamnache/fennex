"""LLM provider dispatch: decrypt org keys, call Anthropic/OpenAI/Google."""
import uuid

import httpx
from anthropic import AsyncAnthropic
from openai import AsyncOpenAI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decrypt_value
from app.models.api_key import APIKey


async def get_org_llm_keys(org_id: uuid.UUID, db: AsyncSession) -> dict[str, str]:
    """Return {provider: plaintext_key} for every API key stored for the org."""
    result = await db.execute(select(APIKey).where(APIKey.org_id == org_id))
    return {k.provider: decrypt_value(k.encrypted_value) for k in result.scalars().all()}


async def call_llm(
    provider: str,
    model: str,
    api_key: str,
    system_prompt: str,
    user_prompt: str,
) -> str:
    """Call the named provider and return the raw text response."""
    if provider == "anthropic":
        return await _call_anthropic(model, api_key, system_prompt, user_prompt)
    if provider == "openai":
        return await _call_openai(model, api_key, system_prompt, user_prompt)
    if provider == "google":
        return await _call_google(model, api_key, system_prompt, user_prompt)
    raise ValueError(f"Unknown provider: {provider}")


async def _call_anthropic(model: str, api_key: str, system_prompt: str, user_prompt: str) -> str:
    client = AsyncAnthropic(api_key=api_key)
    message = await client.messages.create(
        model=model,
        max_tokens=4096,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
    )
    return message.content[0].text


async def _call_openai(model: str, api_key: str, system_prompt: str, user_prompt: str) -> str:
    client = AsyncOpenAI(api_key=api_key)
    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens=4096,
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
