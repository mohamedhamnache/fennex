from app.agents.registry import agent_persona
from app.services.agents.spec import Skill, AgentResult
from app.services.agents.skills._common import brief_block, feedback_block
from app.models.image import GeneratedImage, ImageStatus
from app.services.image_service import generate_image_dalle

_SHOT_DIRECTOR = (
    "You are Mirage. Output ONLY an image-generation prompt for a professional product shot: the product as "
    "the clear hero, studio or lifestyle scene, lighting, surface, mood, palette. NO text, logos or watermarks. Under 80 words."
)


def _shot_prompt(brief, inputs, td):
    p = inputs.get("product") or {}
    user = f"PRODUCT: {p.get('title','')}\nDESCRIPTION: {p.get('description','')}\n" + brief_block(brief) + feedback_block(inputs)
    return _SHOT_DIRECTOR, user


async def _persist_shot(prompt_text, campaign, brief, db):
    from app.services.llm_service import get_org_llm_keys
    keys = await get_org_llm_keys(brief.org_id, db)
    if "openai" not in keys:
        return AgentResult(ok=False, error="Image generation needs an OpenAI key.")
    prompt = (prompt_text or "Professional product shot").strip()[:900]
    result = await generate_image_dalle(prompt=prompt, style="professional", usage="product_shot",
                                        openai_api_key=keys["openai"])
    if not result.get("ok"):
        return AgentResult(ok=False, error=result.get("error", "Image generation failed."))
    img = GeneratedImage(org_id=brief.org_id, project_id=brief.project_id, prompt=prompt,
                         revised_prompt=result.get("revised_prompt"), style="professional", usage="product_shot",
                         status=ImageStatus.ready, image_url=result.get("image_url"),
                         width=result.get("width"), height=result.get("height"), cost_usd=result.get("cost_usd"))
    db.add(img); await db.commit()
    return AgentResult(ok=True, summary="Generated a product shot.", artifact_type="image",
                       artifact_ids=[str(img.id)], structured={"image_id": str(img.id)})


PRODUCT_SHOT = Skill(
    key="mirage.product_shot", agent_id="mirage", weight="heavy", tools=[],
    build_prompt=_shot_prompt, output="text", parse=lambda raw: raw, persist=_persist_shot,
    label="Product shot", description="Art-direct then render a product photo.",
)
