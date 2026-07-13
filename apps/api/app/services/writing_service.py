"""Dune's writing tools: selection transforms and the studio chat co-writer."""
import logging
import re

from app.agents.registry import agent_persona
from app.services.llm_service import call_llm, get_org_llm_keys, project_locale

logger = logging.getLogger(__name__)

MODES = {"rephrase", "simplify", "expand", "shorten", "humanize"}
TRANSFORM_MAX_CHARS = 6000
_PROVIDERS = [("anthropic", "claude-haiku-4-5-20251001"), ("openai", "gpt-4o-mini")]

_MODE_BRIEFS = {
    "rephrase": "Rephrase the text with fresh wording. Preserve meaning, tone and approximate length.",
    "simplify": "Rewrite the text in plain, clear language a 14-year-old understands. Shorter sentences.",
    "expand": "Expand the text with concrete detail, examples or evidence. Up to double the length.",
    "shorten": "Tighten the text to roughly half its length. Keep every essential fact.",
    "humanize": "Rewrite so it reads like a skilled human wrote it: vary sentence lengths, cut cliches and filler, use concrete verbs, allow personality. Never mention AI.",
}


class TextTooLong(Exception): ...


def _pick(keys: dict):
    return next(((p, m) for p, m in _PROVIDERS if p in keys), None)


async def transform(project, mode: str, text: str, db) -> str:
    if mode not in MODES:
        raise ValueError(f"unknown mode: {mode}")
    body = (text or "").strip()
    if not body:
        raise ValueError("text required")
    if len(body) > TRANSFORM_MAX_CHARS:
        raise TextTooLong()
    keys = await get_org_llm_keys(project.org_id, db)
    pm = _pick(keys)
    if pm is None:
        raise RuntimeError("no_ai_key")
    system = (agent_persona("dune") +
              f"You are editing a fragment of a larger article. {_MODE_BRIEFS[mode]} "
              "Return ONLY the rewritten fragment - no preamble, no quotes, no markdown fences.")
    out = await call_llm(pm[0], pm[1], keys[pm[0]], system, body, locale=await project_locale(project.id, db))
    return out.strip()


_DRAFT_RE = re.compile(r"<draft>(.*?)</draft>", re.S)


async def chat(project, article, question: str, history: list[dict], db, live_body: str | None = None) -> dict:
    keys = await get_org_llm_keys(project.org_id, db)
    pm = _pick(keys)
    if pm is None:
        raise RuntimeError("no_ai_key")
    from app.services.ai_analytics_service import project_profile
    profile = await project_profile(project.id, db)
    # Prefer the live editor content (unsaved edits) when provided, so Dune
    # always reasons about exactly what the writer is looking at.
    source = live_body if live_body is not None else (article.body_markdown or "")
    excerpt = source[:6000]
    system = (agent_persona("dune") +
              "You are the writing co-pilot inside the article studio. Converse naturally: "
              "answer questions, research angles from the provided data, and draft content on request. "
              "You can see the writer's current draft below - ground every answer in it and refer to "
              "its actual sections. When your reply contains text meant to be inserted into the article, "
              "wrap exactly that text in <draft></draft> tags (markdown inside). Keep answers tight.")
    convo = "".join(f"{t.get('role', 'user')}: {t.get('content', '')}\n" for t in (history or [])[-7:])
    user = (f"PROJECT: {project.name}" + (f"\nPROFILE: {profile}" if profile else "") +
            f"\nARTICLE: {article.title} (keyword: {article.target_keyword or '-'})\n"
            f"DRAFT EXCERPT:\n{excerpt}\n\n{convo}user: {question.strip()}")
    raw = await call_llm(pm[0], pm[1], keys[pm[0]], system, user, locale=await project_locale(project.id, db))
    m = _DRAFT_RE.search(raw)
    insertable = m.group(1).strip() if m else None
    answer = _DRAFT_RE.sub("", raw).strip() or (insertable[:200] if insertable else raw.strip())
    return {"answer": answer, "insertable": insertable}
