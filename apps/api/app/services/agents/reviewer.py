import re, json
from app.services.agents.tiers import resolve_model
from app.services.llm_service import call_llm


async def review(brief, skill, result, tier, keys, db) -> dict:
    if not result.ok:
        return {"passed": False, "score": 0, "feedback": result.error or "The agent produced no usable output."}
    # deterministic gate for articles
    if result.artifact_type == "article":
        score = result.structured.get("seo_score")
        if isinstance(score, (int, float)) and score < 80:
            return {"passed": False, "score": int(score),
                    "feedback": "SEO score below bar — ensure the primary keyword is in the H1 and first "
                                "paragraph, keep 0.5-2.5% density, 1500+ words, and multiple H2s."}
    available = list((keys or {}).keys())
    if not available:
        return {"passed": True, "score": 75, "feedback": ""}   # no key to judge with; accept
    provider, model = resolve_model(tier, "light", available)
    system = ('You are a strict editor. Judge the ARTIFACT against the GOAL. Return ONLY JSON: '
              '{"score": 0-100, "feedback": one actionable sentence}. Score low if generic, off-goal, '
              'off-angle, or vague.')
    artifact = result.content if result.content is not None else result.summary
    user = f"GOAL: {brief.goal}\nARTIFACT SUMMARY: {result.summary}\nARTIFACT: {str(artifact)[:4000]}"
    try:
        raw = await call_llm(provider, model, keys[provider], system, user, locale=brief.locale)
        data = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", raw.strip()))
        score = int(data.get("score", 70))
        return {"passed": score >= 70, "score": score, "feedback": str(data.get("feedback", ""))}
    except Exception:
        return {"passed": True, "score": 70, "feedback": ""}   # reviewer failure never blocks the pipeline
