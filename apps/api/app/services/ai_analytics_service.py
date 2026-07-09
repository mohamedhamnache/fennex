"""AI Analytics Agent — answers questions about a project's real GSC data."""
import json
import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project

from app.services.llm_service import call_llm, get_org_llm_keys, project_locale
from app.services.analytics_service import (
    get_opportunities,
    get_overview,
    get_rankings,
    get_top_pages,
    get_top_queries,
)

_PROVIDERS = [
    ("anthropic", "claude-opus-4-8"),
    ("openai", "gpt-4o"),
]

_PERSONA_BRIEFS = {
    "creator": (
        "The user is a CONTENT CREATOR (blogger / influencer). Frame every insight as content "
        "strategy: which topics to cover next, which formats win (how-to, list, comparison), "
        "series ideas, decaying posts to refresh, and growing organic reach."
    ),
    "ecommerce": (
        "The user is an ECOMMERCE SELLER (Shopify / WooCommerce). Frame every insight around "
        "revenue: buyer-intent and comparison queries, product & collection pages to build, "
        "titles/meta that lift CTR on money pages, and seasonal demand."
    ),
    "freelancer": (
        "The user is a FREELANCER / AGENCY exploring a market to win clients. Frame every insight "
        "as market analysis: demand sizing, niche gaps, positioning angles, service opportunities, "
        "and client-report-ready takeaways."
    ),
}

_SYSTEM_TEMPLATE = (
    "You have 15 years of experience across content SEO, "
    "ecommerce SEO and market research. You are given a site's REAL Google Search Console data. "
    "Analyse like a professional: use CTR-by-position benchmarks, intent mix, striking-distance "
    "strategy and momentum. Cite specific numbers from the DATA; never invent metrics; be honest "
    "when data is thin.\n\n"
    "{persona_brief}\n\n"
    "Respond with ONLY a JSON object — no markdown, no text outside it:\n"
    "{{\n"
    '  "answer": "expert analysis in plain sentences, under 150 words, ending with a line '
    "'Recommended actions:' followed by 2-4 one-line prioritized actions the user can take inside "
    'Fennex (write/refresh an article, rewrite a title/meta, build a product page, target a query, '
    'create images/social for a winner)",\n'
    '  "chart": null OR {{"type": "bar" or "line", "title": "short title", "x_key": "label", '
    '"series": [{{"key": "clicks", "name": "Clicks"}}], '
    '"data": [{{"label": "example", "clicks": 123}}] (max 8 rows, numbers ONLY from the DATA)}},\n'
    '  "followups": ["2-3 short follow-up questions the user could ask next, each under 8 words"]\n'
    "}}\n"
    "Include a chart ONLY when it makes the answer clearer (top queries/pages by clicks, "
    "opportunities by potential, a trend by date)."
)


def _sanitize_chart(chart) -> dict | None:
    if not isinstance(chart, dict):
        return None
    if chart.get("type") not in ("bar", "line"):
        return None
    data = chart.get("data")
    if not isinstance(data, list) or not data:
        return None
    series = chart.get("series")
    if not isinstance(series, list) or not series:
        # infer series from the first data row's numeric keys (besides x_key)
        xk = chart.get("x_key", "label")
        first = data[0] if isinstance(data[0], dict) else {}
        series = [{"key": k, "name": k.title()} for k, v in first.items() if k != xk and isinstance(v, (int, float))]
        if not series:
            return None
    return {
        "type": chart["type"],
        "title": str(chart.get("title", ""))[:80],
        "x_key": str(chart.get("x_key", "label")),
        "series": [{"key": str(s.get("key")), "name": str(s.get("name", s.get("key")))} for s in series if s.get("key")],
        "data": data[:8],
    }


async def build_context(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession, range_str: str = "28d") -> str:
    ov = await get_overview(project_id, org_id, range_str, db)
    queries = await get_top_queries(project_id, org_id, db)
    pages = await get_top_pages(project_id, org_id, db)
    opps = await get_opportunities(project_id, org_id, db)
    rankings = await get_rankings(project_id, org_id, db, sort_by="change", page=1)

    lines: list[str] = []
    lines.append(f"OVERVIEW (last {range_str}, vs prior period):")
    lines.append(
        f"- Clicks {ov.clicks:,} ({ov.clicks_change:+.0f}%), Impressions {ov.impressions:,} "
        f"({ov.impressions_change:+.0f}%), CTR {ov.ctr * 100:.2f}% ({ov.ctr_change:+.0f}%), "
        f"Avg position {ov.avg_position:.1f} ({ov.position_change:+.0f}% change; lower is better)"
    )

    if queries:
        lines.append("\nTOP QUERIES (real):")
        for q in queries[:10]:
            lines.append(f"- \"{q.query}\": {q.clicks} clicks, {q.impressions} impr, CTR {q.ctr*100:.1f}%, pos {q.avg_position:.1f}")

    if pages:
        lines.append("\nTOP PAGES (real):")
        for p in pages[:8]:
            lines.append(f"- {p.url}: {p.clicks} clicks, pos {p.avg_position:.1f}, CTR {p.ctr*100:.1f}%")

    if opps.striking_distance:
        lines.append(f"\nSTRIKING-DISTANCE OPPORTUNITIES (near page 1, total +{opps.total_potential_clicks} potential clicks):")
        for o in opps.striking_distance[:8]:
            lines.append(f"- \"{o.query}\" pos {o.position:.1f}, {o.impressions} impr, +{o.potential_clicks} potential clicks")

    if opps.ctr_wins:
        lines.append("\nCTR QUICK WINS (page 1, under-performing CTR):")
        for o in opps.ctr_wins[:8]:
            lines.append(f"- \"{o.query}\" pos {o.position:.1f}, CTR {o.ctr*100:.1f}%, +{o.potential_clicks} potential clicks")

    movers = [r for r in rankings if r.position_change is not None]
    if movers:
        winners = sorted(movers, key=lambda r: r.position_change)[:5]  # negative = improved
        losers = sorted(movers, key=lambda r: r.position_change, reverse=True)[:5]
        if any(w.position_change < 0 for w in winners):
            lines.append("\nBIGGEST GAINS (7d):")
            for w in winners:
                if w.position_change < 0:
                    lines.append(f"- \"{w.keyword}\" improved {abs(w.position_change):.1f} to pos {w.current_position:.1f}")
        if any(l.position_change > 0 for l in losers):
            lines.append("\nBIGGEST DROPS (7d):")
            for l in losers:
                if l.position_change > 0:
                    lines.append(f"- \"{l.keyword}\" dropped {l.position_change:.1f} to pos {l.current_position:.1f}")

    if len(lines) <= 2:
        lines.append("\n(No synced Search Console data yet — connect GSC and run a sync.)")

    return "\n".join(lines)


async def project_profile(project_id: uuid.UUID, db: AsyncSession) -> str:
    """Human-readable profile from onboarding answers, for AI prompt grounding."""
    result = await db.execute(select(Project).where(Project.id == project_id))
    p = result.scalar_one_or_none()
    if not p:
        return ""
    parts: list[str] = []
    if p.persona:
        parts.append({"creator": "Content creator (blogger/influencer)",
                      "ecommerce": "Ecommerce seller",
                      "freelancer": "Freelancer/business exploring a market"}.get(p.persona, p.persona))
    d = p.persona_data or {}
    if d.get("niche"):
        parts.append(f"niche: {d['niche']}")
    if d.get("platforms"):
        parts.append(f"publishes on: {', '.join(d['platforms'])}")
    if d.get("store_platform"):
        parts.append(f"store: {d['store_platform']}")
    if d.get("category"):
        parts.append(f"sells: {d['category']}")
    if d.get("services"):
        parts.append(f"services: {d['services']}")
    if d.get("target_market"):
        parts.append(f"target clients: {d['target_market']}")
    if p.industry:
        parts.append(f"industry: {p.industry}")
    if p.locale and p.locale != "en":
        parts.append(f"content language: {p.locale}")
    return "; ".join(parts)


def _sanitize_followups(v) -> list[str]:
    if not isinstance(v, list):
        return []
    out = []
    for item in v[:3]:
        s = str(item).strip()
        if s:
            out.append(s[:80])
    return out


async def answer(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    question: str,
    db: AsyncSession,
    history: list[dict] | None = None,
    persona: str = "creator",
) -> dict:
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"answer": "No AI key configured. Add an Anthropic or OpenAI key in Settings → API Keys to use the analytics agent.", "chart": None, "followups": []}

    from app.agents.registry import agent_persona
    system = agent_persona("zerda") + _SYSTEM_TEMPLATE.format(persona_brief=_PERSONA_BRIEFS.get(persona, _PERSONA_BRIEFS["creator"]))
    context = await build_context(project_id, org_id, db)
    profile = await project_profile(project_id, db)
    profile_block = f"USER PROFILE: {profile}\n\n" if profile else ""
    convo = ""
    for turn in (history or [])[-4:]:
        convo += f"{turn.get('role', 'user')}: {turn.get('content', '')}\n"
    user_prompt = f"{profile_block}DATA:\n{context}\n\n{convo}QUESTION: {question.strip()}"

    raw = None
    for provider, model in _PROVIDERS:
        if provider in keys:
            try:
                raw = await call_llm(provider, model, keys[provider], system, user_prompt, locale=await project_locale(project_id, db))
                break
            except Exception:
                continue
    if raw is None:
        return {"answer": "Could not reach the AI provider — please try again.", "chart": None, "followups": []}

    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
        return {
            "answer": str(parsed.get("answer", "")).strip() or raw.strip(),
            "chart": _sanitize_chart(parsed.get("chart")),
            "followups": _sanitize_followups(parsed.get("followups")),
        }
    except Exception:
        # Model didn't return JSON — treat the whole thing as the answer
        return {"answer": raw.strip(), "chart": None, "followups": []}
