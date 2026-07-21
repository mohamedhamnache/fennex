"""GEO (Generative Engine Optimization) scoring & repair — answer-engine readiness.

Parallels writing_service.py's SEO score/repair. The deterministic core (0-70) is the
single source of truth recomputed anywhere; the LLM judgment (0-30) is added only during
generation. Every LLM path degrades safely and never raises."""
import json
import re
from app.services.llm_service import call_llm

GEO_CORE_FLOOR = 45   # out of 70; below this, generation runs one repair pass


def compute_geo_core(title, body_markdown, meta_description) -> tuple[float, dict]:
    body = body_markdown or ""
    breakdown: dict = {}
    score = 0.0

    # 1. answer_up_top (+15): a plain paragraph (~30-120 words) before the first H2.
    before_h2 = re.split(r"(?m)^##\s", body, maxsplit=1)[0]
    answer = 0
    for para in re.split(r"\n\s*\n", before_h2):
        p = para.strip()
        if not p or p.startswith("#") or p.startswith(("-", "*", ">", "|")) or re.match(r"^\d+\.", p):
            continue
        if 25 <= len(p.split()) <= 120:
            answer = 15
            break
    breakdown["answer_up_top"] = answer; score += answer

    # 2. qa_structure (+12): a heading containing '?' or an FAQ heading.
    qa = 0
    for ln in body.splitlines():
        s = ln.strip()
        if s.startswith("#") and ("?" in s or re.search(r"\bfaq\b|frequently asked", s, re.I)):
            qa = 12; break
    breakdown["qa_structure"] = qa; score += qa

    # 3. extractable_format (+12): a markdown list or table.
    has_list = bool(re.search(r"(?m)^\s*(?:[-*]\s+|\d+\.\s+)", body))
    has_table = bool(re.search(r"\S \| \S", body))
    ef = 12 if (has_list or has_table) else 0
    breakdown["extractable_format"] = ef; score += ef

    # 4. statistics (+10 / +5): count digit characters.
    nums = len(re.findall(r"\d", body))
    stat = 10 if nums >= 6 else (5 if nums >= 3 else 0)
    breakdown["statistics"] = stat; score += stat

    # 5. citations (+11): a markdown http link or a citation phrase.
    cite = 11 if (re.search(r"\[[^\]]+\]\(https?://", body)
                  or re.search(r"according to|source:|\bstudy\b|\breport\b", body, re.I)) else 0
    breakdown["citations"] = cite; score += cite

    # 6. concise_paragraphs (+10 / +5): median paragraph <= 4 sentences.
    paras = [p.strip() for p in re.split(r"\n\s*\n", body)
             if p.strip() and not p.strip().startswith(("#", "-", "*", "|", ">"))]
    conc = 0
    if paras:
        counts = sorted(max(1, len(re.findall(r"[.!?]+", p))) for p in paras)
        median = counts[len(counts) // 2]
        conc = 10 if median <= 4 else (5 if median <= 6 else 0)
    breakdown["concise_paragraphs"] = conc; score += conc

    return round(score, 1), breakdown


_JUDGE_SYSTEM = (
    "You rate how ready a piece of content is to be quoted by an AI answer engine "
    "(ChatGPT, Perplexity, Google AI Overviews). Judge ONLY: is there a genuine, "
    "self-contained, quotable answer an engine could extract and trust; is the tone "
    "factual and authoritative; is it direct. Return ONLY JSON: "
    '{"score": 0-30, "feedback": one short actionable sentence}. No prose, no fences.'
)


async def geo_llm_judgment(provider, model, api_key, title, body_markdown, locale) -> tuple[float, str]:
    user = f"TITLE: {title}\n\nCONTENT:\n{(body_markdown or '')[:6000]}"
    try:
        raw = await call_llm(provider, model, api_key, _JUDGE_SYSTEM, user, locale=locale)
        data = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()))
        score = float(data.get("score", 0))
        score = max(0.0, min(30.0, score))
        return score, str(data.get("feedback", ""))
    except Exception:
        return 0.0, ""


async def compute_geo_score(provider, model, api_key, title, body_markdown, meta_description, locale
                            ) -> tuple[float, dict]:
    core, breakdown = compute_geo_core(title, body_markdown, meta_description)
    judge, feedback = await geo_llm_judgment(provider, model, api_key, title, body_markdown, locale)
    breakdown["llm_judgment"] = judge
    breakdown["llm_feedback"] = feedback
    return round(core + judge, 1), breakdown


_REPAIR_SYSTEM = (
    "You improve an article so AI answer engines will quote it, WITHOUT harming its SEO. "
    "Keep the primary keyword usage, meaning, length and Markdown structure. Add ONLY what is "
    "missing: a concise direct answer (~40-70 words) right after the H1; at least one question-"
    "style H2 or a short FAQ; a bulleted list or table where it fits; one credible source/citation; "
    "and tighten long paragraphs. Return ONLY the full revised article in Markdown, nothing else."
)


async def _repair_geo(provider, model, api_key, title, keyword, body_md, meta, locale) -> str | None:
    user = (f"TITLE: {title}\nPRIMARY KEYWORD: {keyword or title}\n\nARTICLE:\n{body_md}")
    try:
        from app.services.llm_service import ARTICLE_MAX_TOKENS
        out = (await call_llm(provider, model, api_key, _REPAIR_SYSTEM, user,
                              locale=locale, max_tokens=ARTICLE_MAX_TOKENS)).strip()
        return out or None
    except Exception:
        return None


async def ensure_geo_quality(provider, model, api_key, title, keyword, body_md, meta, locale
                             ) -> tuple[str, float, dict]:
    core, _ = compute_geo_core(title, body_md, meta)
    if core < GEO_CORE_FLOOR:
        repaired = await _repair_geo(provider, model, api_key, title, keyword, body_md, meta, locale)
        if repaired:
            body_md = repaired
    score, breakdown = await compute_geo_score(provider, model, api_key, title, body_md, meta, locale)
    return body_md, score, breakdown
