"""
Article Studio — deterministic checks.

Two pure, side-effect-free functions:

- seo_checklist(article, keyword): on-page SEO checklist derived from the
  article's title / meta description / markdown body.
- ai_patterns(text, lang): heuristic "does this read like AI-generated text"
  score plus the signals that drove it.

No DB access, no network calls, no LLM calls — everything here is regex and
arithmetic over the strings passed in, so it is trivially unit-testable.
"""
from __future__ import annotations

import logging
import re
import statistics
from typing import Optional

from app.integrations.seo_apis import get_seo_provider_for_org
from app.services.serp_service import (
    _norm_domain,
    _project_domain,
    language_for_project,
    location_for_project,
)

logger = logging.getLogger(__name__)

# ── Regexes (shared parsing rules, per spec) ────────────────────────────────

_SENTENCE_SPLIT_RE = re.compile(r"[.!?]+\s")
_HEADING_RE = re.compile(r"^#{1,6} ", re.MULTILINE)
_LINK_RE = re.compile(r"\[[^\]]*\]\([^)]+\)")
_IMAGE_RE = re.compile(r"!\[([^\]]*)\]\([^)]+\)")
_LIST_ITEM_RE = re.compile(r"^\s*([-*+]|\d+[.)])\s+")

# ── SEO checklist thresholds (module constants) ─────────────────────────────

TITLE_MIN_LEN = 15
TITLE_MAX_LEN = 65
META_MIN_LEN = 50
META_MAX_LEN = 160
KW_DENSITY_MIN_PCT = 0.3
KW_DENSITY_MAX_PCT = 2.5
MIN_HEADINGS = 3
INTRO_MAX_WORDS = 60
MIN_LINKS = 2
MAX_PARAGRAPH_WORDS = 120

# ── ai_patterns thresholds (module constants) ───────────────────────────────

BURSTINESS_STDDEV_THRESHOLD = 4
BURSTINESS_MIN_SENTENCES = 8
REPEATED_OPENER_MIN_COUNT = 3
UNIFORM_PARAGRAPHS_MIN_COUNT = 4
UNIFORM_PARAGRAPHS_TOLERANCE_PCT = 10
LIST_LINE_OVERUSE_PCT = 30
SCORE_WARN_PENALTY = 25
SCORE_INFO_PENALTY = 10
SCORE_FLOOR = 5
SCORE_MAX = 100
SHORT_TEXT_SENTENCE_THRESHOLD = 8
MAX_FLAGGED_SENTENCES = 10

CLICHE_SEEDS = {
    "en": [
        "delve",
        "in today's fast-paced world",
        "unlock the power",
        "it's important to note",
        "in conclusion",
        "game-changer",
        "furthermore",
    ],
    "fr": [
        "il est important de noter",
        "dans le monde d'aujourd'hui",
        "en conclusion",
        "de plus en plus",
        "un veritable atout",
    ],
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _split_sentences(text: str) -> list[str]:
    parts = _SENTENCE_SPLIT_RE.split(text.strip())
    return [s.strip() for s in parts if s.strip()]


def _split_paragraphs(markdown: str) -> list[str]:
    """Split on blank lines; drop heading-only / image-only lines."""
    blocks = re.split(r"\n\s*\n", markdown.strip())
    paragraphs = []
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        if _HEADING_RE.match(block):
            continue
        if _IMAGE_RE.fullmatch(block):
            continue
        paragraphs.append(block)
    return paragraphs


def _word_count(text: str) -> int:
    return len(text.split())


def _kw_check(present: bool) -> str:
    return "pass" if present else "fail"


# ── seo_checklist ────────────────────────────────────────────────────────────

def seo_checklist(article, keyword: Optional[str]) -> list[dict]:
    title = getattr(article, "title", "") or ""
    meta = getattr(article, "meta_description", "") or ""
    body = getattr(article, "body_markdown", "") or ""

    kw = keyword.strip() if keyword else None
    kw_lower = kw.lower() if kw else None

    checks: list[dict] = []

    # title_length
    title_len = len(title)
    if TITLE_MIN_LEN <= title_len <= TITLE_MAX_LEN:
        status = "pass"
    else:
        status = "fail"
    checks.append({
        "id": "title_length",
        "status": status,
        "detail": f"Title is {title_len} chars (recommended {TITLE_MIN_LEN}-{TITLE_MAX_LEN}).",
    })

    # meta_length
    meta_len = len(meta)
    if META_MIN_LEN <= meta_len <= META_MAX_LEN:
        status = "pass"
    else:
        status = "fail"
    checks.append({
        "id": "meta_length",
        "status": status,
        "detail": f"Meta description is {meta_len} chars (recommended {META_MIN_LEN}-{META_MAX_LEN}).",
    })

    paragraphs = _split_paragraphs(body)
    intro = paragraphs[0] if paragraphs else ""
    heading_lines = [
        line for line in body.splitlines() if _HEADING_RE.match(line)
    ]

    # kw_in_title / kw_in_intro / kw_in_heading / kw_density
    if kw_lower is None:
        for rule_id in ("kw_in_title", "kw_in_intro", "kw_in_heading", "kw_density"):
            checks.append({
                "id": rule_id,
                "status": "warn",
                "detail": "no keyword set",
            })
    else:
        checks.append({
            "id": "kw_in_title",
            "status": _kw_check(kw_lower in title.lower()),
            "detail": f"Keyword {'found' if kw_lower in title.lower() else 'missing'} in title.",
        })
        checks.append({
            "id": "kw_in_intro",
            "status": _kw_check(kw_lower in intro.lower()),
            "detail": f"Keyword {'found' if kw_lower in intro.lower() else 'missing'} in intro paragraph.",
        })
        checks.append({
            "id": "kw_in_heading",
            "status": _kw_check(any(kw_lower in h.lower() for h in heading_lines)),
            "detail": f"Keyword {'found' if any(kw_lower in h.lower() for h in heading_lines) else 'missing'} in a heading.",
        })

        body_words = _word_count(body)
        occurrences = len(re.findall(re.escape(kw_lower), body.lower()))
        density_pct = (occurrences / body_words * 100) if body_words else 0.0
        if occurrences == 0:
            status = "fail"
        elif KW_DENSITY_MIN_PCT <= density_pct <= KW_DENSITY_MAX_PCT:
            status = "pass"
        else:
            status = "warn"
        checks.append({
            "id": "kw_density",
            "status": status,
            "detail": f"Keyword density is {density_pct:.2f}% ({occurrences} occurrences).",
        })

    # headings_count
    heading_count = len(heading_lines)
    checks.append({
        "id": "headings_count",
        "status": "pass" if heading_count >= MIN_HEADINGS else "fail",
        "detail": f"Found {heading_count} heading(s) (recommended >= {MIN_HEADINGS}).",
    })

    # intro_length
    intro_words = _word_count(intro)
    checks.append({
        "id": "intro_length",
        "status": "pass" if intro_words <= INTRO_MAX_WORDS else "warn",
        "detail": f"Intro paragraph is {intro_words} words (recommended <= {INTRO_MAX_WORDS}).",
    })

    # links
    link_count = len(_LINK_RE.findall(body))
    checks.append({
        "id": "links",
        "status": "pass" if link_count >= MIN_LINKS else "warn",
        "detail": f"Found {link_count} markdown link(s) (recommended >= {MIN_LINKS}).",
    })

    # image_alts
    image_alts = _IMAGE_RE.findall(body)
    empty_alts = sum(1 for alt in image_alts if not alt.strip())
    checks.append({
        "id": "image_alts",
        "status": "pass" if empty_alts == 0 else "fail",
        "detail": (
            "No images found." if not image_alts
            else f"{empty_alts} of {len(image_alts)} image(s) missing alt text."
        ),
    })

    # paragraph_length
    long_paragraphs = [p for p in paragraphs if _word_count(p) > MAX_PARAGRAPH_WORDS]
    checks.append({
        "id": "paragraph_length",
        "status": "pass" if not long_paragraphs else "warn",
        "detail": (
            "All paragraphs are within the recommended length."
            if not long_paragraphs
            else f"{len(long_paragraphs)} paragraph(s) exceed {MAX_PARAGRAPH_WORDS} words."
        ),
    })

    return checks


# ── ai_patterns ──────────────────────────────────────────────────────────────

def ai_patterns(text: str, lang: str) -> dict:
    sentences = _split_sentences(text)
    paragraphs = [p for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    lines = [line for line in text.splitlines() if line.strip()]

    signals: list[dict] = []
    flagged: list[dict] = []

    sentence_word_counts = [_word_count(s) for s in sentences]

    # burstiness
    if len(sentences) >= BURSTINESS_MIN_SENTENCES:
        stddev = statistics.pstdev(sentence_word_counts)
        if stddev < BURSTINESS_STDDEV_THRESHOLD:
            signals.append({
                "id": "burstiness",
                "severity": "warn",
                "detail": f"Sentence length stddev is {stddev:.2f} (< {BURSTINESS_STDDEV_THRESHOLD}), rhythm is unusually uniform.",
            })

    # repeated_openers
    opener_counts: dict[str, list[str]] = {}
    for s in sentences:
        words = s.split()
        if not words:
            continue
        opener = words[0]
        opener_counts.setdefault(opener, []).append(s)

    repeated_openers = {
        opener: sents for opener, sents in opener_counts.items()
        if len(sents) >= REPEATED_OPENER_MIN_COUNT
    }
    if repeated_openers:
        top_opener = max(repeated_openers, key=lambda o: len(repeated_openers[o]))
        signals.append({
            "id": "repeated_openers",
            "severity": "warn",
            "detail": f"The word \"{top_opener}\" opens {len(repeated_openers[top_opener])} sentences.",
        })
        for s in repeated_openers[top_opener]:
            flagged.append({
                "sentence": s,
                "reason": f"Repeated opener: \"{top_opener}\"",
            })

    # cliches
    seeds = CLICHE_SEEDS.get(lang, CLICHE_SEEDS["en"])
    text_lower = text.lower()
    hit_seeds = [seed for seed in seeds if seed.lower() in text_lower]
    if hit_seeds:
        signals.append({
            "id": "cliches",
            "severity": "warn",
            "detail": f"Contains cliche phrase(s): {', '.join(hit_seeds)}.",
        })
        for s in sentences:
            s_lower = s.lower()
            if any(seed.lower() in s_lower for seed in hit_seeds):
                flagged.append({
                    "sentence": s,
                    "reason": f"Cliche phrase detected: \"{next(seed for seed in hit_seeds if seed.lower() in s_lower)}\"",
                })

    # uniform_paragraphs
    if len(paragraphs) >= UNIFORM_PARAGRAPHS_MIN_COUNT:
        para_word_counts = [_word_count(p) for p in paragraphs]
        avg = sum(para_word_counts) / len(para_word_counts)
        if avg > 0 and all(
            abs(wc - avg) / avg * 100 <= UNIFORM_PARAGRAPHS_TOLERANCE_PCT
            for wc in para_word_counts
        ):
            signals.append({
                "id": "uniform_paragraphs",
                "severity": "info",
                "detail": f"{len(paragraphs)} paragraphs all within +/-{UNIFORM_PARAGRAPHS_TOLERANCE_PCT}% of the average length.",
            })

    # formatting_overuse
    if lines:
        list_line_count = sum(1 for line in lines if _LIST_ITEM_RE.match(line))
        list_pct = list_line_count / len(lines) * 100
        if list_pct > LIST_LINE_OVERUSE_PCT:
            signals.append({
                "id": "formatting_overuse",
                "severity": "info",
                "detail": f"{list_pct:.0f}% of lines are list items (> {LIST_LINE_OVERUSE_PCT}%).",
            })

    # score
    if len(sentences) < SHORT_TEXT_SENTENCE_THRESHOLD and not signals:
        score = SCORE_MAX
    else:
        warn_count = sum(1 for s in signals if s["severity"] == "warn")
        info_count = sum(1 for s in signals if s["severity"] == "info")
        score = SCORE_MAX - (SCORE_WARN_PENALTY * warn_count) - (SCORE_INFO_PENALTY * info_count)
        score = max(SCORE_FLOOR, score)

    # de-dupe flagged sentences (a sentence could match both repeated_opener
    # and cliche) while preserving order, then cap at MAX_FLAGGED_SENTENCES.
    seen = set()
    deduped_flagged = []
    for f in flagged:
        key = f["sentence"]
        if key in seen:
            continue
        seen.add(key)
        deduped_flagged.append(f)
    deduped_flagged = deduped_flagged[:MAX_FLAGGED_SENTENCES]

    return {
        "score": score,
        "signals": signals,
        "flagged": deduped_flagged,
    }


# ── plagiarism_scan ──────────────────────────────────────────────────────────

PLAGIARISM_SENTENCE_MIN_WORDS = 10
PLAGIARISM_SENTENCE_MAX_WORDS = 20
PLAGIARISM_MAX_SENTENCES_CHECKED = 8
PLAGIARISM_MAX_URLS_PER_MATCH = 3
DISTINCTIVE_WORD_MIN_LETTERS = 6


class NoProvider(Exception):
    """Raised when the org has no configured SEO/SERP provider."""


_HEADING_LINE_RE = re.compile(r"^#{1,6} .*$")
_LIST_ITEM_LINE_RE = re.compile(r"^\s*([-*+]|\d+[.)])\s+.*$")


def _is_heading_or_list_sentence(sentence: str) -> bool:
    """True when the whole sentence IS a heading/list line (not merely
    contains one) — e.g. a standalone "## Prix" split out with no
    sentence-ending punctuation."""
    return bool(_HEADING_LINE_RE.fullmatch(sentence) or _LIST_ITEM_LINE_RE.fullmatch(sentence))


def _plagiarism_candidate_sentences(body: str) -> list[str]:
    """Pick up to PLAGIARISM_MAX_SENTENCES_CHECKED distinctive sentences.

    The body is split into sentences; sentences that are themselves a
    heading or list line are dropped, and the rest are kept when they have
    10-20 words; ranked by count of "distinctive" words (> 6 letters)
    descending.
    """
    candidates: list[str] = []
    for sentence in _split_sentences(body):
        if _is_heading_or_list_sentence(sentence):
            continue
        word_count = _word_count(sentence)
        if PLAGIARISM_SENTENCE_MIN_WORDS <= word_count <= PLAGIARISM_SENTENCE_MAX_WORDS:
            candidates.append(sentence)

    def distinctiveness(sentence: str) -> int:
        return sum(1 for w in sentence.split() if len(w) > DISTINCTIVE_WORD_MIN_LETTERS)

    candidates.sort(key=distinctiveness, reverse=True)
    return candidates[:PLAGIARISM_MAX_SENTENCES_CHECKED]


async def plagiarism_scan(project, article, db) -> dict:
    """Scan an article's most distinctive sentences against live SERPs.

    For each sampled sentence, query the quoted phrase and flag it as a
    potential match when the SERP returns an organic result whose domain
    differs from the project's own domain. `checked` only counts sentences
    that were successfully queried (a SERP error for a sentence logs and
    skips it, and it is not counted towards `checked`).
    """
    provider = await get_seo_provider_for_org(project.org_id, db)
    if provider is None:
        raise NoProvider("No SEO provider configured for this organization.")

    body = getattr(article, "body_markdown", "") or ""
    sentences = _plagiarism_candidate_sentences(body)

    language_code = language_for_project(project)
    location_code = location_for_project(project)
    own_domain = _project_domain(project)

    checked = 0
    matches: list[dict] = []

    for sentence in sentences:
        try:
            items = await provider.serp(
                f'"{sentence}"', language_code=language_code, location_code=location_code
            )
        except Exception:
            logger.exception("plagiarism_scan: SERP query failed for sentence, skipping.")
            continue

        checked += 1

        urls: list[str] = []
        for item in items or []:
            if item.get("type") != "organic":
                continue
            if _norm_domain(item.get("domain", "")) == own_domain:
                continue
            url = item.get("url")
            if url:
                urls.append(url)
            if len(urls) >= PLAGIARISM_MAX_URLS_PER_MATCH:
                break

        if urls:
            matches.append({"sentence": sentence, "urls": urls})

    return {"checked": checked, "matches": matches}
