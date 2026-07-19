"""Oasis — Market Researcher. Generates a client-ready market report (Markdown)
grounded in the project's real Search Console data."""
import json
import re
import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.registry import agent_persona
from app.models.project import Project
from app.services.ai_analytics_service import project_profile
from app.services.analytics_service import (
    get_health_score,
    get_market_insights,
    get_opportunities,
    get_overview,
)
from app.services.llm_service import call_llm, get_org_llm_keys

_PROVIDERS = [
    ("anthropic", "claude-opus-4-8"),
    ("openai", "gpt-4o"),
]

_SYSTEM = agent_persona("oasis") + (
    "Produce a complete MARKET REPORT in clean Markdown from the DATA provided. "
    "Structure exactly:\n"
    "# <report title>\n"
    "## Executive summary  (4-6 sentences, the headline findings)\n"
    "## Market demand  (size the demand from impressions/clicks; what people search for)\n"
    "## Topic landscape  (the main themes, with numbers per cluster)\n"
    "## Opportunity analysis  (the concrete wins, with estimated potential)\n"
    "## Risks & gaps  (weak areas: CTR, positions, missing content types)\n"
    "## Recommendations  (5-7 prioritized, actionable steps)\n\n"
    "Rules: cite ONLY numbers present in the DATA — never invent figures. Where the data "
    "is thin, say so plainly. Write for a paying client: professional, direct, no fluff, "
    "no emoji. Around 500-700 words."
)


async def generate_market_report(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> dict:
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"ok": False, "error": "No AI key configured. Add an Anthropic or OpenAI key in Settings."}

    project = await db.get(Project, project_id)
    name = project.name if project else "Project"
    domain = project.domain if project else ""

    ov = await get_overview(project_id, org_id, "28d", db)
    market = await get_market_insights(project_id, org_id, db)
    opps = await get_opportunities(project_id, org_id, db)
    health = await get_health_score(project_id, org_id, db)
    profile = await project_profile(project_id, db)

    lines: list[str] = [f"SITE: {name} ({domain})"]
    if profile:
        lines.append(f"CLIENT PROFILE: {profile}")
    lines.append(
        f"\nLAST 28 DAYS: {ov.clicks:,} clicks ({ov.clicks_change:+.0f}%), "
        f"{ov.impressions:,} impressions ({ov.impressions_change:+.0f}%), "
        f"CTR {ov.ctr * 100:.2f}%, avg position {ov.avg_position:.1f}. "
        f"SEO health score {health.score}/100 (grade {health.grade})."
    )
    if health.components:
        lines.append("HEALTH BREAKDOWN: " + "; ".join(f"{c.label} {c.score}/100 ({c.detail})" for c in health.components))
    if market.clusters:
        lines.append("\nTOPIC CLUSTERS:")
        for c in market.clusters[:10]:
            lines.append(f"- {c.topic}: {c.query_count} queries, {c.clicks} clicks, {c.impressions} impressions, avg pos {c.avg_position}")
    if market.ideas:
        lines.append("\nDEMAND (content ideas by type):")
        for i in market.ideas[:15]:
            lines.append(f"- [{i.idea_type}] \"{i.query}\" — {i.impressions} impressions, pos {i.position}")
    if opps.striking_distance or opps.ctr_wins:
        lines.append(f"\nOPPORTUNITIES (total +{opps.total_potential_clicks} potential clicks):")
        for o in (opps.striking_distance + opps.ctr_wins)[:10]:
            lines.append(f"- [{o.kind}] \"{o.query}\" pos {o.position:.1f}, {o.impressions} impr, +{o.potential_clicks} potential")

    user_prompt = "DATA:\n" + "\n".join(lines) + f"\n\nToday: {date.today().isoformat()}. Write the market report."

    for provider, model in _PROVIDERS:
        if provider in keys:
            try:
                md = (await call_llm(provider, model, keys[provider], _SYSTEM, user_prompt, locale=(project.locale if project else "en"))).strip()
                return {"ok": True, "title": f"{name} — Market Report", "markdown": md, "generated_at": date.today().isoformat()}
            except Exception:
                continue
    return {"ok": False, "error": "Could not reach the AI provider — please try again."}


_ICP_SYSTEM = agent_persona("oasis") + (
    "From the freelancer/business PROFILE and any market DATA, define 3 ideal client "
    "segments to target. Respond with ONLY valid JSON, no markdown fences:\n"
    "{\n"
    '  "segments": [\n'
    '    {"name": "short segment name", "description": "1-2 sentences: industry, size, role/decision-maker", '
    '"pains": ["2-4 concrete pains this segment feels"], '
    '"channels": ["2-3 concrete places to find and reach them"], '
    '"angle": "one-sentence messaging angle that resonates"}\n'
    "  ]\n"
    "}\n"
    "Rules: be specific to the niche and services — no generic filler, no emoji. If the profile "
    "is thin, infer sensibly from the niche but stay realistic."
)


async def generate_icp(project_id: uuid.UUID, org_id: uuid.UUID, db: AsyncSession) -> dict:
    """Oasis defines the ideal customer profile segments for outreach targeting."""
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"ok": False, "error": "no_ai_key"}

    project = await db.get(Project, project_id)
    name = project.name if project else "Project"
    profile = await project_profile(project_id, db)
    market = await get_market_insights(project_id, org_id, db)

    lines = [f"FREELANCER/BUSINESS: {name}"]
    if profile:
        lines.append(f"PROFILE: {profile}")
    if market.clusters:
        lines.append("TOP TOPICS THEY RANK/COMPETE FOR: " + ", ".join(c.topic for c in market.clusters[:8]))
    user_prompt = "\n".join(lines) + "\n\nDefine the ideal client segments."

    raw = None
    for provider, model in _PROVIDERS:
        if provider in keys:
            try:
                raw = await call_llm(provider, model, keys[provider], _ICP_SYSTEM, user_prompt,
                                     locale=(project.locale if project else "en"))
                break
            except Exception:
                continue
    if raw is None:
        return {"ok": False, "error": "provider_unreachable"}

    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except Exception:
        return {"ok": False, "error": "bad_format"}

    segments = []
    for s in (parsed.get("segments") or [])[:4]:
        if not isinstance(s, dict):
            continue
        nm = str(s.get("name", "")).strip()
        desc = str(s.get("description", "")).strip()
        if not nm or not desc:
            continue
        segments.append({
            "name": nm[:80],
            "description": desc[:400],
            "pains": [str(p).strip() for p in (s.get("pains") or []) if str(p).strip()][:4],
            "channels": [str(c).strip() for c in (s.get("channels") or []) if str(c).strip()][:3],
            "angle": str(s.get("angle", "")).strip()[:300],
        })
    if not segments:
        return {"ok": False, "error": "bad_format"}
    return {"ok": True, "segments": segments}
