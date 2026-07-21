"""Nomad — Outreach Agent. Standalone endpoints run on the agent core: the
outreach and testimonial skills carry the specialized prompts + grounding, and
these functions stay thin wrappers (outreach still saves posts as Social drafts)."""
from app.models.social import SocialPlatform, SocialPost, SocialPostStatus, SocialPostType
from app.services.agents.skills import nomad as nomad_skills
from app.services.agents.standalone import run_standalone

_POST_TYPES = {t.value for t in SocialPostType}
_TESTIMONIAL_FORMATS = {"linkedin_post", "case_study", "quote_card", "website_blurb"}


async def generate_outreach_plan(project_id, org_id, goal, db, audience="") -> dict:
    inputs = {"audience": audience, "goal": goal}
    result = await run_standalone(nomad_skills.OUTREACH_PLAN, project_id, org_id,
                                  (goal or "Attract new clients on LinkedIn"), db, inputs=inputs)
    if not result.ok:
        return {"ok": False, "error": result.error or "Could not reach the AI provider — please try again."}
    parsed = result.content or {}
    posts = _sanitize_posts(parsed.get("posts"))
    messages = _sanitize_messages(parsed.get("messages"))
    tips = [str(t).strip() for t in parsed.get("tips", []) if str(t).strip()][:5]
    if not posts:
        return {"ok": False, "error": "The AI returned no usable posts — please try again."}

    # Save the post series as LinkedIn drafts so the user can review and publish from Social
    for p in posts:
        db.add(SocialPost(org_id=org_id, project_id=project_id, platform=SocialPlatform.linkedin,
                          post_type=SocialPostType(p["type"]), status=SocialPostStatus.draft,
                          content=p["content"], hashtags=p["hashtags"], char_count=len(p["content"])))
    await db.commit()

    return {"ok": True, "posts": posts, "messages": messages, "tips": tips, "drafts_saved": len(posts)}


async def generate_testimonial_content(project_id, org_id, testimonial, client, service, db) -> dict:
    testimonial = (testimonial or "").strip()
    if not testimonial:
        return {"ok": False, "error": "empty"}
    inputs = {"testimonial": testimonial, "client": client, "service": service}
    result = await run_standalone(nomad_skills.TESTIMONIAL_CONTENT, project_id, org_id,
                                  "Turn a client testimonial into social-proof content.", db, inputs=inputs)
    if not result.ok:
        return {"ok": False, "error": result.error or "provider_unreachable"}
    pieces = []
    for item in (result.content or {}).get("pieces", []):
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
