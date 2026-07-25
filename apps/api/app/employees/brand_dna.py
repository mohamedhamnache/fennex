"""Brand DNA -- the company's identity, injected into every employee.

Assembled once per run by the Orchestrator and handed to every employee as part
of the work context. The rule the whole framework depends on:

    An employee must never ask the user for something Brand DNA already knows.

Sources are the existing BrandVoice / BrandKit / Project records, so the DNA is
whatever the user already configured -- no new data entry.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select


@dataclass
class BrandDNA:
    # narrative
    mission: str = ""
    vision: str = ""
    voice: str = ""
    tone: str = ""
    writing_style: str = ""
    # visual identity
    colors: list[str] = field(default_factory=list)
    typography: str = ""
    logo: str = ""
    visual_identity: str = ""
    # market
    products: list[str] = field(default_factory=list)
    audience: str = ""
    competitors: list[str] = field(default_factory=list)
    # rails
    vocabulary: list[str] = field(default_factory=list)
    avoid_words: list[str] = field(default_factory=list)
    negative_prompts: list[str] = field(default_factory=list)
    quality_rules: list[str] = field(default_factory=list)
    constraints: list[str] = field(default_factory=list)
    # context
    locale: str = "en"
    project_profile: str = ""
    # A cached ~120-word summary of the project's own documents. Carried
    # always; the documents themselves are fetched only on request.
    knowledge_digest: str = ""

    def is_empty(self) -> bool:
        return not any([self.mission, self.voice, self.tone, self.audience,
                        self.products, self.colors, self.project_profile,
                        self.knowledge_digest])

    def to_dict(self) -> dict:
        return {
            "mission": self.mission, "vision": self.vision, "voice": self.voice,
            "tone": self.tone, "writingStyle": self.writing_style,
            "colors": self.colors, "typography": self.typography, "logo": self.logo,
            "visualIdentity": self.visual_identity, "products": self.products,
            "audience": self.audience, "competitors": self.competitors,
            "vocabulary": self.vocabulary, "avoidWords": self.avoid_words,
            "negativePrompts": self.negative_prompts, "qualityRules": self.quality_rules,
            "constraints": self.constraints, "locale": self.locale,
        }

    # -- prompt rendering ------------------------------------------------------

    def as_prompt(self, *, visual: bool = False) -> str:
        """The block injected into an employee's system prompt.

        `visual=True` promotes the visual identity for image employees; text
        employees get the voice rails instead. Keeping one renderer means the
        brand can never drift between departments.
        """
        if self.is_empty():
            return ""
        lines: list[str] = ["BRAND DNA -- this is settled context. Never ask the user for it."]

        def add(label: str, value) -> None:
            if not value:
                return
            if isinstance(value, list):
                value = ", ".join(str(v) for v in value if v)
            if value:
                lines.append(f"{label}: {value}")

        add("What this project is", self.mission)
        add("Vision", self.vision)
        add("Audience", self.audience)
        add("Products", self.products[:12])
        add("Competitors", self.competitors[:8])

        if visual:
            add("Visual identity", self.visual_identity)
            add("Palette", self.colors[:8])
            add("Typography", self.typography)
            add("Never render", self.negative_prompts[:12])
        else:
            add("Voice", self.voice)
            add("Tone", self.tone)
            add("Writing style", self.writing_style)
            add("Preferred vocabulary", self.vocabulary[:20])
            add("Never use", self.avoid_words[:20])

        add("Quality rules", self.quality_rules[:10])
        add("Hard constraints", self.constraints[:10])
        if self.project_profile:
            lines.append(f"Project profile: {self.project_profile}")
        if self.knowledge_digest:
            lines.append(
                "WHAT THIS PROJECT'S OWN DOCUMENTS ESTABLISH (never contradict this; "
                "use the project documents tool when you need the detail):\n"
                + self.knowledge_digest)
        return "\n".join(lines)


# --- assembly -----------------------------------------------------------------


async def build(project_id: uuid.UUID, org_id: uuid.UUID, db) -> BrandDNA:
    """Assemble Brand DNA from whatever the org has configured.

    Every source is optional and independently guarded: a half-configured brand
    still yields usable DNA rather than failing the whole run.
    """
    from app.models.brand_kit import BrandKit
    from app.models.brand_voice import BrandVoice
    from app.models.project import Project

    dna = BrandDNA()

    try:
        from app.services.llm_service import project_locale
        dna.locale = await project_locale(project_id, db) or "en"
    except Exception:
        dna.locale = "en"

    try:
        from app.services.ai_analytics_service import project_profile
        dna.project_profile = await project_profile(project_id, db) or ""
    except Exception:
        dna.project_profile = ""

    try:
        project = await db.get(Project, project_id)
    except Exception:
        project = None
    if project is not None:
        dna.knowledge_digest = _attr(project, "knowledge_digest") or ""
        dna.mission = _attr(project, "description") or _attr(project, "goal") or ""
        dna.audience = _attr(project, "target_audience") or _attr(project, "audience") or ""
        niche = _attr(project, "niche") or _attr(project, "industry")
        if niche and not dna.vision:
            dna.vision = f"Lead the {niche} conversation."

    try:
        voice = (await db.execute(
            select(BrandVoice).where(BrandVoice.org_id == org_id, BrandVoice.project_id == project_id)
            .order_by(BrandVoice.is_default.desc())
        )).scalars().first()
    except Exception:
        voice = None
    if voice is not None:
        dna.voice = _attr(voice, "voice_prompt") or ""
        tone = _attr(voice, "tone")
        dna.tone = tone.value if hasattr(tone, "value") else (tone or "")
        dna.writing_style = _attr(voice, "writing_style") or _attr(voice, "style") or ""
        dna.vocabulary = list(_attr(voice, "vocabulary") or [])
        dna.avoid_words = list(_attr(voice, "avoid_words") or [])

    try:
        kit = (await db.execute(
            select(BrandKit).where(BrandKit.org_id == org_id, BrandKit.project_id == project_id)
        )).scalars().first()
    except Exception:
        kit = None
    if kit is not None:
        dna.colors = list(_attr(kit, "colors") or [])
        dna.typography = _attr(kit, "primary_font") or ""
        dna.logo = _attr(kit, "logo_url") or ""
        dna.visual_identity = _attr(kit, "style_rules") or ""
        dna.negative_prompts = _as_list(_attr(kit, "negative_prompts"))
        if not dna.tone:
            kit_tone = _attr(kit, "tone")
            dna.tone = kit_tone.value if hasattr(kit_tone, "value") else (kit_tone or "")

    dna.products = await _products(project_id, org_id, db)
    dna.competitors = await _competitors(project_id, org_id, db)
    dna.quality_rules = _default_quality_rules(dna)
    return dna


def _attr(obj, name: str):
    return getattr(obj, name, None)


def _as_list(value) -> list[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if v]
    return [p.strip() for p in str(value).split(",") if p.strip()]


async def _products(project_id, org_id, db) -> list[str]:
    try:
        from app.models.store_product import StoreProduct
        rows = (await db.execute(
            select(StoreProduct.title).where(StoreProduct.project_id == project_id).limit(25)
        )).scalars().all()
        return [r for r in rows if r]
    except Exception:
        return []


async def _competitors(project_id, org_id, db) -> list[str]:
    try:
        from app.models.seo_intel import Competitor
        rows = (await db.execute(
            select(Competitor.domain).where(Competitor.project_id == project_id).limit(10)
        )).scalars().all()
        return [r for r in rows if r]
    except Exception:
        return []


def _default_quality_rules(dna: BrandDNA) -> list[str]:
    """Non-negotiables every employee inherits."""
    rules = [
        "Be specific: no filler, no hedging, no restating the prompt.",
        "Never invent statistics, quotes, prices or client names.",
        "Match the brand voice exactly -- consistency beats cleverness.",
    ]
    if dna.avoid_words:
        rules.append("Respect the banned vocabulary without exception.")
    return rules
