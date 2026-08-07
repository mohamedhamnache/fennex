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


async def _source_product_image(brief, db) -> tuple[str | None, str | None]:
    """A real product photo to condition on, from the connected store.

    This is the whole difference between the two paths. flux-kontext-pro
    RE-SCENES the merchant's actual product; text-to-image invents one that
    merely resembles it. For an ecommerce merchant that is the difference
    between a usable asset and a plausible fake, so the real photo is looked
    for first and text-to-image is the fallback, never the default.
    """
    try:
        from sqlalchemy import select
        from app.models.store_product import StoreProduct

        row = (await db.execute(
            select(StoreProduct.image_url, StoreProduct.title).where(
                StoreProduct.project_id == brief.project_id,
                StoreProduct.org_id == brief.org_id,
                StoreProduct.image_url.isnot(None),
            ).limit(1)
        )).first()
        return (row[0], row[1]) if row else (None, None)
    except Exception:  # noqa: BLE001 - no catalogue is a normal state, not an error
        return None, None


async def _persist_shot(prompt_text, campaign, brief, db):
    from app.core.config import settings
    from app.services.llm_service import get_org_llm_keys

    prompt = (prompt_text or "Professional product shot").strip()[:900]

    # An image the user attached wins over the catalogue: they pointed at a
    # specific photo, and guessing a different product from the store would be
    # answering a question they did not ask.
    attached = ((getattr(brief, "runtime", None) or {}).get("attachment") or {}).get("url")
    if attached:
        source_url, source_title = attached, "the image you attached"
    else:
        source_url, source_title = await _source_product_image(brief, db)

    # The studio's path, reused rather than reimplemented: same model, same
    # metered chokepoint (_replicate_run, which applies MIN_REPLICATE_CREDITS),
    # so a product shot from chat costs what one from the studio costs.
    if source_url and settings.REPLICATE_API_KEY:
        from app.api.v1.routers.product import _run_flux_kontext

        result = await _run_flux_kontext(source_url, prompt, aspect_ratio="1:1")
        engine, style = "flux-kontext-pro", "photorealistic"
    else:
        keys = await get_org_llm_keys(brief.org_id, db)
        if "openai" not in keys:
            return AgentResult(ok=False, error="Image generation needs an OpenAI key.")
        result = await generate_image_dalle(prompt=prompt, style="professional",
                                            usage="product_shot", openai_api_key=keys["openai"])
        engine, style = "gpt-image", "professional"

    if not result.get("ok"):
        return AgentResult(ok=False, error=result.get("error", "Image generation failed."))
    img = GeneratedImage(org_id=brief.org_id, project_id=brief.project_id, prompt=prompt,
                         revised_prompt=result.get("revised_prompt"), style=style,
                         usage="product_shot", status=ImageStatus.ready,
                         image_url=result.get("image_url"),
                         width=result.get("width"), height=result.get("height"),
                         cost_usd=result.get("cost_usd"))
    db.add(img); await db.commit()

    # The summary says which it was. A merchant who thinks their own product was
    # photographed, when it was invented from a description, ships the wrong
    # image -- and only finds out from a customer.
    summary = ("Re-scened your product photo" + (f" ({source_title})" if source_title else "")
               if engine == "flux-kontext-pro"
               else "Generated a product shot from the description "
                    "(no product image synced, so this is not your actual product)")
    return AgentResult(ok=True, summary=summary, artifact_type="image",
                       artifact_ids=[str(img.id)],
                       structured={"image_id": str(img.id), "engine": engine,
                                   "sourceImage": source_url})


PRODUCT_SHOT = Skill(
    key="mirage.product_shot", agent_id="mirage", weight="heavy", tools=[],
    build_prompt=_shot_prompt, output="text", parse=lambda raw: raw, persist=_persist_shot,
    label="Product shot", description="Art-direct then render a product photo.",
    # Same shape as sirocco.generate_visual: the whole output is an
    # image-generation prompt under 80 words. No max_tokens override existed,
    # so this drops the ceiling from the 4096 default to 512, a decrease.
    feature="image_prompt",
)
