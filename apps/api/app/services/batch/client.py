"""OpenAI Batch API submission and inline polling.

A one-request batch earns the same 50% discount as a large one, so this submits
and waits rather than splitting callers into submit/resume halves. Returning
None means "fall back to the interactive path" -- a batch problem must never
kill a scheduled job.
"""
import asyncio
import io
import json
import logging
import time

from openai import AsyncOpenAI

from app.services.llm_service import LLMUsage

logger = logging.getLogger(__name__)

SUPPORTED_PROVIDERS = ("openai",)
POLL_INTERVAL_SECONDS = 20
MAX_WAIT_SECONDS = 6 * 60 * 60  # batches usually settle in minutes; 24h is the SLA
_TERMINAL_BAD = {"failed", "expired", "cancelled", "cancelling"}


async def run_batched(provider: str, model: str, api_key: str, system_prompt: str,
                      user_prompt: str, max_tokens: int) -> tuple[str, LLMUsage] | None:
    if provider not in SUPPORTED_PROVIDERS:
        return None
    try:
        client = AsyncOpenAI(api_key=api_key)
        line = {
            "custom_id": "req-0",
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": model,
                "messages": [{"role": "system", "content": system_prompt},
                             {"role": "user", "content": user_prompt}],
                "max_tokens": max_tokens,
            },
        }
        payload = io.BytesIO((json.dumps(line) + "\n").encode())
        payload.name = "batch.jsonl"
        uploaded = await client.files.create(file=payload, purpose="batch")
        batch = await client.batches.create(
            input_file_id=uploaded.id,
            endpoint="/v1/chat/completions",
            completion_window="24h",
        )
        deadline = time.monotonic() + MAX_WAIT_SECONDS
        while batch.status not in ("completed",) and batch.status not in _TERMINAL_BAD:
            if time.monotonic() > deadline:
                logger.warning("batch %s still %s after the wait cap; falling back",
                               batch.id, batch.status)
                return None
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            batch = await client.batches.retrieve(batch.id)
        if batch.status != "completed" or not batch.output_file_id:
            logger.warning("batch %s ended as %s; falling back", batch.id, batch.status)
            return None
        content = await client.files.content(batch.output_file_id)
        raw = content.read() if hasattr(content, "read") else content
        record = json.loads((raw.decode() if isinstance(raw, bytes) else raw).splitlines()[0])
        body = record["response"]["body"]
        text = body["choices"][0]["message"]["content"]
        usage = body.get("usage") or {}
        cached = (usage.get("prompt_tokens_details") or {}).get("cached_tokens", 0) or 0
        return text, LLMUsage("openai", model,
                              input_tokens=usage.get("prompt_tokens", 0) or 0,
                              output_tokens=usage.get("completion_tokens", 0) or 0,
                              cache_read_tokens=cached, batch=True)
    except Exception:
        logger.exception("batch call failed; falling back to the interactive path")
        return None
