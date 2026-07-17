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
_META_T_RE = re.compile(r"<meta_title>(.*?)</meta_title>", re.S)
_META_D_RE = re.compile(r"<meta_description>(.*?)</meta_description>", re.S)


async def _seo_grounding(project, article, live_body: str | None, db, include_checks: bool = True) -> str:
    """Real data Dune grounds its SEO skills in: deterministic on-page issues,
    the site's actual GSC queries, and the keywords tracked in the SEO hub.
    Every source is optional - failures degrade to an empty section."""
    parts: list[str] = []
    if include_checks:
        try:
            from app.services import checks_service
            probe = article
            if live_body is not None:
                import types
                probe = types.SimpleNamespace(
                    title=article.title,
                    meta_description=article.meta_description,
                    body_markdown=live_body,
                )
            issues = [
                f"- {c['id']}: {c['detail']}"
                for c in checks_service.seo_checklist(probe, article.target_keyword)
                if c["status"] != "pass"
            ][:8]
            if issues:
                parts.append("ON-PAGE ISSUES (deterministic checker):\n" + "\n".join(issues))
        except Exception:
            logger.warning("chat grounding: checks failed", exc_info=True)
    try:
        from app.services.analytics_service import get_top_queries
        queries = await get_top_queries(project.id, project.org_id, db)
        if queries:
            rows = [f"- {q.query} ({q.clicks} clicks, pos {round(q.position, 1)})" for q in queries[:8]]
            parts.append("REAL SEARCH QUERIES this site already gets (GSC):\n" + "\n".join(rows))
    except Exception:
        logger.warning("chat grounding: gsc queries failed", exc_info=True)
    try:
        from sqlalchemy import select
        from app.models.seo_intel import TrackedKeyword
        result = await db.execute(
            select(TrackedKeyword.keyword)
            .where(TrackedKeyword.project_id == project.id, TrackedKeyword.is_active.is_(True))
            .limit(8)
        )
        kws = [r[0] for r in result.all()]
        if kws:
            parts.append("KEYWORDS TRACKED in the SEO hub: " + ", ".join(kws))
    except Exception:
        logger.warning("chat grounding: tracked keywords failed", exc_info=True)
    return "\n\n".join(parts)


async def _prepare_chat(project, article, question: str, history: list[dict], db, live_body: str | None):
    """Resolve provider + build the full chat prompt. Returns
    (provider, model, api_key, system, user, locale)."""
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
    grounding = await _seo_grounding(project, article, live_body, db)
    system = (agent_persona("dune") +
              "You are the agentic writing co-pilot inside the article studio. You do not just advise - "
              "you DO the work, in ONE turn, using these SKILLS:\n"
              "1. REVISE ARTICLE - when asked to change, optimize, rewrite, restructure, fix or improve the "
              "article: one- or two-sentence summary of what you changed, then the revised article in clean "
              "markdown wrapped in <article></article>.\n"
              "   CRITICAL: <article> must ALWAYS contain the ENTIRE article - the full H1 and every section. "
              "For a targeted request (e.g. 'rewrite the introduction'), change ONLY that part and reproduce "
              "every other section word for word. NEVER return only the changed section; NEVER drop content "
              "the user did not ask to remove.\n"
              "2. INSERT PASSAGE - when asked to draft a specific new passage: wrap exactly that passage in "
              "<draft></draft> (markdown inside).\n"
              "3. SET METADATA - when asked for meta/SEO title or description: output them in "
              "<meta_title></meta_title> (<=60 chars) and/or <meta_description></meta_description> "
              "(<=160 chars) tags. Combine with skill 1 when doing a full SEO pass.\n"
              "4. ANSWER & RESEARCH - otherwise answer concisely, grounded in the draft and the DATA below.\n"
              "USE THE DATA: when optimizing SEO, fix the listed on-page issues and weave the site's real "
              "search queries and tracked keywords into headings and copy where natural - never stuff. "
              "Apply your full SEO craft (intent, E-E-A-T, semantic coverage, snippet answer, FAQ). "
              "Keep the chat message itself short.")
    convo = "".join(f"{t.get('role', 'user')}: {t.get('content', '')}\n" for t in (history or [])[-7:])
    user = (f"PROJECT: {project.name}" + (f"\nPROFILE: {profile}" if profile else "") +
            f"\nARTICLE: {article.title} (keyword: {article.target_keyword or '-'})" +
            (f"\n\nDATA:\n{grounding}" if grounding else "") +
            f"\n\nCURRENT ARTICLE (markdown):\n{excerpt}\n\n{convo}user: {question.strip()}")
    return pm[0], pm[1], keys[pm[0]], system, user, await project_locale(project.id, db)


async def chat(project, article, question: str, history: list[dict], db, live_body: str | None = None) -> dict:
    provider, model, key, system, user, locale = await _prepare_chat(
        project, article, question, history, db, live_body
    )
    raw = await call_llm(provider, model, key, system, user, locale=locale)
    return parse_chat_response(raw)


async def chat_stream(project, article, question: str, history: list[dict], db, live_body: str | None = None):
    """Async generator yielding raw text chunks of Dune's reply. The caller
    accumulates and runs parse_chat_response() on the full text at the end.
    All DB work happens up-front, so the stream itself needs no session."""
    provider, model, key, system, user, locale = await _prepare_chat(
        project, article, question, history, db, live_body
    )
    from app.services.llm_service import stream_llm
    async for chunk in stream_llm(provider, model, key, system, user, locale=locale):
        yield chunk


def parse_chat_response(raw: str) -> dict:
    """Extract Dune's structured skill outputs from a raw chat response."""
    am = _ARTICLE_RE.search(raw)
    revised = am.group(1).strip() if am else None
    rest = _ARTICLE_RE.sub("", raw)
    mt = _META_T_RE.search(rest)
    md_ = _META_D_RE.search(rest)
    meta_title = mt.group(1).strip() if mt else None
    meta_description = md_.group(1).strip() if md_ else None
    rest = _META_T_RE.sub("", _META_D_RE.sub("", rest))
    m = _DRAFT_RE.search(rest)
    insertable = m.group(1).strip() if m else None
    answer = _DRAFT_RE.sub("", rest).strip() or (insertable[:200] if insertable else raw.strip())
    if revised and not answer:
        answer = "I've updated the article."
    return {
        "answer": answer,
        "insertable": insertable,
        "revised": revised,
        "meta_title": meta_title,
        "meta_description": meta_description,
    }
