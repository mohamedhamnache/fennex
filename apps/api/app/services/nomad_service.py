"""Nomad — Outreach Agent. Generates a week-long LinkedIn outreach plan
(post series + DM templates) and saves the posts as drafts in Social."""
import json
import re
import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.registry import agent_persona
from app.models.project import Project
from app.models.social import SocialPlatform, SocialPost, SocialPostStatus, SocialPostType
from app.services.ai_analytics_service import project_profile
from app.services.llm_service import call_llm, get_org_llm_keys

_PROVIDERS = [
    ("anthropic", "claude-opus-4-8"),
    ("openai", "gpt-4o"),
]

_POST_TYPES = {t.value for t in SocialPostType}

_SYSTEM = agent_persona("nomad") + (
    "Build a one-week LinkedIn outreach plan for the GOAL provided, grounded in the "
    "client profile. Respond with ONLY valid JSON, no markdown fences:\n"
    "{\n"
    '  "posts": [5 items, one per weekday: {"day": "Monday", "type": "tip|question|announcement|article_share", '
    '"content": "full post text, 600-1300 chars, line breaks with \\n, a clear hook in line 1, no emoji", '
    '"hashtags": ["#tag1", "#tag2", "#tag3"]}],\n'
    '  "messages": [3 items: {"scenario": "when to send this DM", "content": "connection/follow-up message under 300 chars"}],\n'
    '  "tips": [3-5 short outreach tips specific to this client]\n'
    "}\n"
    "Rules: every post must be specific to the client's niche and services — a reader "
    "should learn something real. Vary the types across the week. DMs must reference "
    "value, never open with a pitch. No emoji anywhere."
)


async def generate_outreach_plan(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    goal: str,
    db: AsyncSession,
    audience: str = "",
) -> dict:
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"ok": False, "error": "No AI key configured. Add an Anthropic or OpenAI key in Settings."}

    project = await db.get(Project, project_id)
    name = project.name if project else "Project"
    profile = await project_profile(project_id, db)

    user_prompt = (
        f"CLIENT: {name}"
        + (f"\nCLIENT PROFILE: {profile}" if profile else "")
        + (f"\nTARGET AUDIENCE (ideal client to speak to): {audience.strip()}" if audience.strip() else "")
        + f"\nGOAL: {goal.strip() or 'Attract new clients on LinkedIn'}"
        + f"\nWeek starting: {date.today().isoformat()}"
    )

    raw = None
    for provider, model in _PROVIDERS:
        if provider in keys:
            try:
                raw = await call_llm(provider, model, keys[provider], _SYSTEM, user_prompt, locale=(project.locale if project else "en"))
                break
            except Exception:
                continue
    if raw is None:
        return {"ok": False, "error": "Could not reach the AI provider — please try again."}

    cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
    cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        parsed = json.loads(cleaned)
    except Exception:
        return {"ok": False, "error": "The AI returned an unexpected format — please try again."}

    posts = _sanitize_posts(parsed.get("posts"))
    messages = _sanitize_messages(parsed.get("messages"))
    tips = [str(t).strip() for t in parsed.get("tips", []) if str(t).strip()][:5]
    if not posts:
        return {"ok": False, "error": "The AI returned no usable posts — please try again."}

    # Save the post series as LinkedIn drafts so the user can review and publish from Social
    for p in posts:
        db.add(
            SocialPost(
                org_id=org_id,
                project_id=project_id,
                platform=SocialPlatform.linkedin,
                post_type=SocialPostType(p["type"]),
                status=SocialPostStatus.draft,
                content=p["content"],
                hashtags=p["hashtags"],
                char_count=len(p["content"]),
            )
        )
    await db.commit()

    return {"ok": True, "posts": posts, "messages": messages, "tips": tips, "drafts_saved": len(posts)}


_TESTIMONIAL_SYSTEM = agent_persona("nomad") + (
    "Turn a client TESTIMONIAL into ready-to-use social proof content for a freelancer's "
    "personal brand. Respond with ONLY valid JSON, no markdown fences:\n"
    "{\n"
    '  "pieces": [\n'
    '    {"format": "linkedin_post", "content": "story-driven LinkedIn post: hook line, challenge, what you did, the result, a light CTA; 600-1200 chars; \\n line breaks; no emoji"},\n'
    '    {"format": "case_study", "content": "2-3 sentence outcome-focused case-study snippet"},\n'
    '    {"format": "quote_card", "content": "one short punchy pull-quote from the testimonial for a graphic"},\n'
    '    {"format": "website_blurb", "content": "one polished sentence for a website testimonials section"}\n'
    "  ]\n"
    "}\n"
    "Rules: keep the client's authentic voice; NEVER invent facts, metrics or names not in the "
    "testimonial; if a detail isn't given, stay general. No emoji anywhere."
)

_TESTIMONIAL_FORMATS = {"linkedin_post", "case_study", "quote_card", "website_blurb"}


async def generate_testimonial_content(
    project_id: uuid.UUID,
    org_id: uuid.UUID,
    testimonial: str,
    client: str,
    service: str,
    db: AsyncSession,
) -> dict:
    testimonial = (testimonial or "").strip()
    if not testimonial:
        return {"ok": False, "error": "empty"}
    keys = await get_org_llm_keys(org_id, db)
    if not keys:
        return {"ok": False, "error": "no_ai_key"}

    project = await db.get(Project, project_id)
    profile = await project_profile(project_id, db)
    user_prompt = f"TESTIMONIAL: {testimonial}"
    if client.strip():
        user_prompt += f"\nCLIENT: {client.strip()}"
    if service.strip():
        user_prompt += f"\nSERVICE PROVIDED: {service.strip()}"
    if profile:
        user_prompt += f"\nYOUR PROFILE: {profile}"

    raw = None
    for provider, model in _PROVIDERS:
        if provider in keys:
            try:
                raw = await call_llm(provider, model, keys[provider], _TESTIMONIAL_SYSTEM, user_prompt,
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

    pieces = []
    for item in (parsed.get("pieces") or []):
        if not isinstance(item, dict):
            continue
        fmt = str(item.get("format", "")).strip()
        content = str(item.get("content", "")).strip()
        if fmt in _TESTIMONIAL_FORMATS and content:
            pieces.append({"format": fmt, "content": content[:3000]})
    if not pieces:
        return {"ok": False, "error": "bad_format"}
    return {"ok": True, "pieces": pieces}


def _sanitize_posts(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    posts = []
    for item in raw[:7]:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        post_type = str(item.get("type", "tip")).strip()
        if post_type not in _POST_TYPES:
            post_type = "tip"
        hashtags = [str(h).strip() for h in item.get("hashtags", []) if str(h).strip()][:5]
        posts.append(
            {
                "day": str(item.get("day", "")).strip(),
                "type": post_type,
                "content": content[:3000],
                "hashtags": hashtags,
            }
        )
    return posts


def _sanitize_messages(raw) -> list[dict]:
    if not isinstance(raw, list):
        return []
    messages = []
    for item in raw[:5]:
        if not isinstance(item, dict):
            continue
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        messages.append({"scenario": str(item.get("scenario", "")).strip(), "content": content[:600]})
    return messages
