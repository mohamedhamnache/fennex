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
_ARTICLE_RE = re.compile(r"<article>(.*?)</article>", re.S)


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
    excerpt = source[:8000]
    system = (agent_persona("dune") +
              "You are the agentic writing co-pilot inside the article studio. You do not just advise - "
              "you DO the work. The writer's full draft is below.\n"
              "- If the user asks a question or wants research, answer concisely, grounded in the draft.\n"
              "- If the user asks you to INSERT a specific new passage, wrap exactly that passage in "
              "<draft></draft> tags (markdown inside).\n"
              "- If the user asks you to CHANGE, OPTIMIZE, REWRITE, RESTRUCTURE, FIX or IMPROVE the article "
              "itself (e.g. 'optimize the SEO of this article', 'make the intro stronger', 'add an FAQ'), you "
              "MUST EXECUTE it: give a one- or two-sentence summary of what you changed, then output the "
              "COMPLETE revised article in clean markdown wrapped in <article></article> tags. Apply your full "
              "SEO skill set (intent, headings, keyword placement, structure, snippet answer, FAQ) and keep "
              "everything that was already good. Never output <article> unless you are actually rewriting the "
              "article. Keep the chat message itself short.")
    convo = "".join(f"{t.get('role', 'user')}: {t.get('content', '')}\n" for t in (history or [])[-7:])
    user = (f"PROJECT: {project.name}" + (f"\nPROFILE: {profile}" if profile else "") +
            f"\nARTICLE: {article.title} (keyword: {article.target_keyword or '-'})\n"
            f"CURRENT ARTICLE (markdown):\n{excerpt}\n\n{convo}user: {question.strip()}")
    raw = await call_llm(pm[0], pm[1], keys[pm[0]], system, user, locale=await project_locale(project.id, db))
    am = _ARTICLE_RE.search(raw)
    revised = am.group(1).strip() if am else None
    raw_wo_article = _ARTICLE_RE.sub("", raw)
    m = _DRAFT_RE.search(raw_wo_article)
    insertable = m.group(1).strip() if m else None
    answer = _DRAFT_RE.sub("", raw_wo_article).strip() or (insertable[:200] if insertable else raw.strip())
    if revised and not answer:
        answer = "I've updated the article."
    return {"answer": answer, "insertable": insertable, "revised": revised}
