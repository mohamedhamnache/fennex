from app.agents.registry import agent_persona
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.skills._common import brief_block, feedback_block, parse_json
from app.models.social import SocialPost, SocialPlatform, SocialPostStatus, SocialPostType
from app.models.image import GeneratedImage, ImageStatus
from app.services.image_service import generate_image_dalle

_PLATFORMS = ["linkedin", "instagram", "twitter", "facebook", "tiktok"]


def _social_prompt(brief, inputs, td):
    topic = inputs.get("topic") or brief.goal
    platforms = [p for p in (inputs.get("platforms") or ["linkedin", "instagram", "twitter"]) if p in _PLATFORMS]
    system = (
        agent_persona("sirocco")
        + " Write native social posts for each requested network from ONE topic. No emoji. "
        'Return ONLY JSON: {"variants": [{"platform": str, "content": str, "hashtags": [str]}]}. '
        "Tune length and voice to each network."
    )
    user = (f"TOPIC: {topic}\nNETWORKS: {', '.join(platforms)}\n" + brief_block(brief) + feedback_block(inputs))
    return system, user


async def _persist_social(content, campaign, brief, db):
    ids = []
    for v in (content or {}).get("variants", []):
        try:
            plat = SocialPlatform(v["platform"])
        except (ValueError, KeyError):
            continue
        body = v.get("content", "")
        post = SocialPost(org_id=brief.org_id, project_id=brief.project_id, platform=plat,
                          post_type=SocialPostType.tip, status=SocialPostStatus.draft,
                          content=body, hashtags=v.get("hashtags", []), char_count=len(body))
        db.add(post); await db.flush(); ids.append(str(post.id))
    await db.commit()
    return AgentResult(ok=True, summary=f"Drafted {len(ids)} native social posts.",
                       artifact_type="social", artifact_ids=ids, structured={"count": len(ids)})


MULTI_NETWORK_SOCIAL = Skill(
    key="sirocco.multi_network_social", agent_id="sirocco", weight="light", tools=[],
    build_prompt=_social_prompt, output="json", parse=parse_json, persist=_persist_social,
    label="Multi-network social", description="Native post variants per network from the angle.",
)


_ART_DIRECTOR = (
    "You are Sirocco, a creative director. Output ONLY an image-generation prompt (no quotes, no preamble). "
    "Describe a specific scene: subject and focal point, composition, setting, lighting, mood, a tight color "
    "palette, and art style. ABSOLUTELY NO text, letters, numbers, logos, watermarks, charts or UI. Under 80 words."
)


def _visual_prompt(brief, inputs, td):
    subject = inputs.get("topic") or brief.goal
    user = f"Campaign goal: {brief.goal}\nAngle: {subject}\n" + brief_block(brief) + feedback_block(inputs)
    return _ART_DIRECTOR, user


async def _persist_visual(prompt_text, campaign, brief, db):
    from app.services.llm_service import get_org_llm_keys
    keys = await get_org_llm_keys(brief.org_id, db)
    if "openai" not in keys:
        return AgentResult(ok=False, error="Image generation needs an OpenAI key.")
    prompt = (prompt_text or f"Marketing visual for: {brief.goal}").strip()[:900]
    result = await generate_image_dalle(prompt=prompt, style="professional", usage="marketing_banner",
                                        openai_api_key=keys["openai"])
    if not result.get("ok"):
        return AgentResult(ok=False, error=result.get("error", "Image generation failed."))
    img = GeneratedImage(org_id=brief.org_id, project_id=brief.project_id, prompt=prompt,
                         revised_prompt=result.get("revised_prompt"), style="professional",
                         usage="marketing_banner", status=ImageStatus.ready, image_url=result.get("image_url"),
                         width=result.get("width"), height=result.get("height"), cost_usd=result.get("cost_usd"))
    db.add(img); await db.commit()
    return AgentResult(ok=True, summary="Generated a campaign visual.", artifact_type="image",
                       artifact_ids=[str(img.id)], structured={"image_id": str(img.id)})


GENERATE_VISUAL = Skill(
    key="sirocco.generate_visual", agent_id="sirocco", weight="heavy", tools=[],
    build_prompt=_visual_prompt, output="text", parse=lambda raw: raw, persist=_persist_visual,
    label="Generate a visual", description="Art-direct then render a campaign image.",
)
