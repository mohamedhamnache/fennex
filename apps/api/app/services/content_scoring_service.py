"""Content scoring vs the live top-10 SERP: deterministic term/structure analysis
plus one optional locale-aware LLM brief (Dune)."""
import logging
import re
from collections import Counter
from datetime import date, timedelta

import httpx
from sqlalchemy import select

from app.core.config import settings
from app.models.seo_intel import SerpSnapshot, TrackedKeyword
from app.services.serp_service import fetch_serp
from app.services.llm_service import call_llm, get_org_llm_keys

logger = logging.getLogger(__name__)

TOP_PAGES = 5
TERMS_LIMIT = 20
SNAPSHOT_MAX_AGE_DAYS = 7

_STOPWORDS = {
    "en": {"the", "a", "an", "and", "or", "of", "to", "in", "for", "on", "with", "is", "are",
           "your", "you", "it", "this", "that", "at", "by", "from", "as", "be", "we", "our"},
    "fr": {"le", "la", "les", "un", "une", "des", "et", "ou", "de", "du", "en", "pour", "sur",
           "avec", "est", "sont", "votre", "vos", "vous", "ce", "cette", "au", "aux", "par",
           "dans", "que", "qui", "plus", "pas", "nous", "notre"},
}


class NoProvider(Exception): ...


async def _crawl_page(url: str) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{settings.CRAWLER_SERVICE_URL}/crawl", json={"url": url})
        resp.raise_for_status()
        page = resp.json()
    if page.get("error") or (page.get("status_code") or 0) >= 400:
        raise RuntimeError(page.get("error") or "crawl failed")
    return page


def _tokenize(text: str, lang: str) -> list[str]:
    words = re.findall(r"[a-z0-9à-öø-ÿœç']+", (text or "").lower())
    stop = _STOPWORDS.get(lang, _STOPWORDS["en"])
    return [w for w in words if len(w) > 2 and w not in stop]


async def _serp_top10(project, keyword: str, db) -> list[dict]:
    tk = (await db.execute(select(TrackedKeyword).where(
        TrackedKeyword.project_id == project.id, TrackedKeyword.keyword == keyword,
    ))).scalars().first()
    if tk is not None:
        snap = (await db.execute(select(SerpSnapshot).where(
            SerpSnapshot.tracked_keyword_id == tk.id,
            SerpSnapshot.date >= date.today() - timedelta(days=SNAPSHOT_MAX_AGE_DAYS),
        ).order_by(SerpSnapshot.date.desc()))).scalars().first()
        if snap is not None and snap.top10:
            return snap.top10
    serp = await fetch_serp(project, keyword, db)
    if serp is None:
        raise NoProvider()
    return serp["top10"]


async def score_content(project, keyword: str, db, *, article_id=None, url=None, text=None) -> dict:
    lang = (project.locale or "en")[:2].lower()
    if article_id is not None:
        from app.models.article import Article
        art = await db.get(Article, article_id)
        content = f"{art.title or ''}\n{art.body_markdown or ''}" if art else ""
        my_headings = len(re.findall(r"^#{1,3} ", art.body_markdown or "", re.M)) if art else 0
    elif url is not None:
        page = await _crawl_page(url)
        content = page.get("text") or ""
        my_headings = len(page.get("h2") or [])
    elif text is not None:
        content = text
        my_headings = 0
    else:
        raise ValueError("one of article_id, url, text is required")

    top10 = await _serp_top10(project, keyword, db)
    corpus_tokens: list[str] = []
    word_counts: list[int] = []
    heading_counts: list[int] = []
    questions: list[str] = []
    analyzed = 0
    for item in top10[:TOP_PAGES]:
        try:
            page = await _crawl_page(item["url"])
        except Exception:
            continue
        analyzed += 1
        corpus_tokens.extend(_tokenize(page.get("text") or "", lang))
        word_counts.append(int(page.get("word_count") or 0))
        heading_counts.append(len(page.get("h2") or []))
        for h in (page.get("h2") or []):
            if "?" in h:
                questions.append(h)
    if analyzed == 0:
        raise RuntimeError("Could not analyze any top-ranking page.")

    top_terms = [t for t, _ in Counter(corpus_tokens).most_common(TERMS_LIMIT)]
    mine = Counter(_tokenize(content, lang))
    corpus_freq = Counter(corpus_tokens)
    terms = []
    present = 0
    for term in top_terms:
        target = max(1, round(corpus_freq[term] / max(analyzed, 1) / 4))
        count = mine.get(term, 0)
        if count == 0:
            status = "missing"
        elif count < target:
            status = "underused"
        else:
            status = "present"
            present += 1
        terms.append({"term": term, "status": status, "count": count, "target": target})

    word_counts.sort()
    median_words = word_counts[len(word_counts) // 2] if word_counts else 0
    my_words = len(content.split())
    coverage = present / max(len(top_terms), 1)
    length_ratio = min(my_words / median_words, 1.0) if median_words else 0.0
    score = round(coverage * 70 + length_ratio * 30)

    brief = None
    try:
        keys = await get_org_llm_keys(project.org_id, db)
        pm = next(((p, m) for p, m in [("anthropic", "claude-haiku-4-5-20251001"), ("openai", "gpt-4o-mini")] if p in keys), None)
        provider, model = pm if pm else ("anthropic", "claude-haiku-4-5-20251001")
        api_key = keys.get(provider, "")
        missing = ", ".join(t["term"] for t in terms if t["status"] != "present")[:400]
        brief = (await call_llm(provider, model, api_key,
            "You are Dune, an SEO content editor. Given gaps versus top-ranking pages, "
            "write a prioritized 4-6 bullet improvement brief. Be concrete and terse.",
            f"KEYWORD: {keyword}\nMY WORD COUNT: {my_words} (SERP median {median_words})\n"
            f"WEAK/MISSING TERMS: {missing}\nQUESTIONS ON SERP: {'; '.join(questions[:6])}",
            locale=project.locale)).strip()
    except Exception:
        brief = None

    return {"score": score, "terms": terms,
            "structure": {"word_count": my_words, "target_words": median_words,
                          "headings": my_headings,
                          "target_headings": (sorted(heading_counts)[len(heading_counts) // 2] if heading_counts else 0)},
            "questions": questions[:10], "brief": brief,
            "serp_median_words": median_words, "pages_analyzed": analyzed}
