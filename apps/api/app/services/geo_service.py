"""GEO (Generative Engine Optimization) scoring & repair — answer-engine readiness.

Parallels writing_service.py's SEO score/repair. The deterministic core (0-70) is the
single source of truth recomputed anywhere; the LLM judgment (0-30) is added only during
generation. Every LLM path degrades safely and never raises."""
import re

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
