import uuid
from dataclasses import dataclass, field

from sqlalchemy import select

from app.services.agents.spec import AgentResult


@dataclass
class Brief:
    goal: str
    persona: str
    project_id: uuid.UUID
    org_id: uuid.UUID
    locale: str
    project_profile: str
    brand: dict
    existing_content: list[str]
    artifacts: list[dict] = field(default_factory=list)

    def add_artifact(self, result: AgentResult, agent_id: str, skill_key: str) -> None:
        self.artifacts.append({
            "agent": agent_id,
            "skill": skill_key,
            "summary": result.summary,
            "artifact_type": result.artifact_type,
            "artifact_ids": result.artifact_ids,
            "structured": result.structured,
        })


async def build_brief(project_id, org_id, goal: str, persona: str, db) -> Brief:
    from app.models.article import Article
    from app.models.brand_voice import BrandVoice
    from app.models.brand_kit import BrandKit
    from app.services.ai_analytics_service import project_profile
    from app.services.llm_service import project_locale

    profile = ""
    try:
        profile = await project_profile(project_id, db)
    except Exception:
        profile = ""
    locale = "en"
    try:
        locale = await project_locale(project_id, db)
    except Exception:
        locale = "en"

    brand: dict = {}
    try:
        voice = (await db.execute(
            select(BrandVoice).where(BrandVoice.org_id == org_id).order_by(BrandVoice.is_default.desc())
        )).scalars().first()
        kit = (await db.execute(select(BrandKit).where(BrandKit.org_id == org_id))).scalars().first()
        if voice:
            tone = voice.tone.value if hasattr(voice.tone, "value") else voice.tone
            brand.update({"voice_prompt": voice.voice_prompt, "tone": tone,
                          "vocabulary": voice.vocabulary or [], "avoid_words": voice.avoid_words or []})
        if kit:
            brand["kit"] = {"colors": kit.colors or [], "primary_font": kit.primary_font,
                            "style_rules": kit.style_rules, "tone": kit.tone}
    except Exception:
        brand = {}

    try:
        titles = (await db.execute(
            select(Article.title).where(Article.project_id == project_id, Article.org_id == org_id)
            .order_by(Article.created_at.desc()).limit(20)
        )).scalars().all()
    except Exception:
        titles = []

    return Brief(goal=goal, persona=persona, project_id=project_id, org_id=org_id, locale=locale,
                 project_profile=profile, brand=brand, existing_content=[t for t in titles if t],
                 artifacts=[])
