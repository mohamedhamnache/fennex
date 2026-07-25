"""Turn a confirmed DiscoveryRun into a working workspace: project, Brand DNA,
knowledge embeddings, and seeded employee memory. Idempotent -- a re-run on a
run whose ``project_id`` is already set updates the same rows in place rather
than duplicating them.

Every field read from ``DiscoveryRun.result`` is treated as optional: a
description-only onboarding (no crawl) leaves most of it empty, and this
service must still produce a usable workspace. See
``app/services/discovery/extractors.py:empty_result`` for the canonical shape.
"""
import re
import uuid

from sqlalchemy import select

from app.api.v1.routers.brand_kit import get_or_create_for_project
from app.employees import memory as memory_layer
from app.employees.spec import SCOPE_PROJECT
from app.models.brand_voice import BrandVoice, VoiceTone
from app.models.discovery import DiscoveryRun
from app.models.knowledge import ProjectDocument
from app.models.project import Project
from app.services import knowledge_service
from app.services.llm_service import get_org_llm_keys

# The single knowledge-base document this service maintains per project. Kept
# constant so a re-provision can find and replace it instead of piling up
# duplicates.
PROFILE_DOC_KIND = "profile"


def _profile_document(r: dict) -> str:
    b, brand = r.get("business") or {}, r.get("brand") or {}
    lines = [f"# {b.get('name') or 'Our business'}"]
    if b.get("description"):
        lines.append(b["description"])
    if b.get("industry"):
        lines.append(f"Industry: {b['industry']}")
    if brand.get("mission"):
        lines.append(f"Mission: {brand['mission']}")
    if brand.get("values"):
        lines.append("Values: " + ", ".join(brand["values"]))
    for p in r.get("products") or []:
        lines.append(f"Product: {p.get('name')} -- {p.get('description') or ''}")
    for icp in r.get("audience") or []:
        lines.append(f"Audience: {icp.get('label')} -- pains: {', '.join(icp.get('pains') or [])}")
    return "\n\n".join(lines)


def _fallback_domain(b: dict, run: DiscoveryRun) -> str:
    """Project.domain is NOT NULL. A description-only run has no URL and no
    discovered domain, so fabricate a readable placeholder rather than
    letting the insert fail."""
    domain = b.get("domain") or run.input_url
    if domain:
        return domain[:255]
    name = b.get("name") or "workspace"
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "workspace"
    return f"{slug}-{str(run.id)[:8]}.local"[:255]


def _map_tone(raw) -> VoiceTone:
    """BrandVoice.tone is a closed enum; the discovery result's brand.tone is
    free-form LLM text (e.g. "warm", "playful"). Map case-insensitively onto
    the enum, falling back to professional when there is no exact match."""
    if raw:
        normalized = str(raw).strip().lower()
        for tone in VoiceTone:
            if tone.value == normalized:
                return tone
    return VoiceTone.professional


async def provision(run_id: uuid.UUID, *, persona: str | None, db) -> uuid.UUID:
    run = await db.get(DiscoveryRun, run_id)
    if run is None:
        raise ValueError("Discovery run not found")
    r = run.result or {}
    b, brand = r.get("business") or {}, r.get("brand") or {}
    org_id = run.org_id

    # 1. Project (idempotent on run.project_id)
    project = await db.get(Project, run.project_id) if run.project_id else None
    if project is None:
        project = Project(
            id=uuid.uuid4(), org_id=org_id,
            name=(b.get("name") or "My Workspace")[:255],
            domain=_fallback_domain(b, run),
        )
        db.add(project)
        await db.flush()
        run.project_id = project.id
    project.name = (b.get("name") or project.name)[:255]
    project.locale = (b.get("language") or project.locale or "en")[:10]
    project.target_country = (b.get("country") or project.target_country)
    if project.target_country:
        project.target_country = project.target_country[:10]
    project.industry = (b.get("industry") or project.industry)
    if project.industry:
        project.industry = project.industry[:100]
    project.description = b.get("description") or project.description
    project.persona = persona or project.persona
    pd = dict(project.persona_data or {})
    pd.update({
        "socials": b.get("socials", {}),
        "timezone": b.get("timezone"),
        "cms": b.get("cms"),
        "navigation": b.get("navigation", []),
        "goals": r.get("goals", []),
        "success_metrics": r.get("success_metrics", []),
        "competitors": r.get("competitors", []),
        "suggested_keywords": (r.get("seo") or {}).get("suggested_keywords", []),
    })
    project.persona_data = pd
    if brand.get("colors"):
        project.theme = project.theme or "desert"
    await db.flush()

    # 2. Brand DNA: BrandKit (free-text tone) + BrandVoice (closed tone enum)
    kit = await get_or_create_for_project(project.id, org_id, db)
    kit.colors = brand.get("colors") or kit.colors
    kit.logo_url = brand.get("logo_url") or kit.logo_url
    kit.primary_font = brand.get("primary_font") or kit.primary_font
    kit.secondary_font = brand.get("secondary_font") or kit.secondary_font
    kit.tone = brand.get("tone") or kit.tone

    # A project may accrue several voices after onboarding, so pick the default
    # (or oldest) rather than assuming exactly one -- scalar_one_or_none would
    # raise MultipleResultsFound on a re-provision of such a project.
    voice = (await db.execute(
        select(BrandVoice)
        .where(BrandVoice.project_id == project.id, BrandVoice.org_id == org_id)
        .order_by(BrandVoice.is_default.desc(), BrandVoice.created_at.asc())
        .limit(1)
    )).scalars().first()
    if voice is None:
        voice = BrandVoice(id=uuid.uuid4(), org_id=org_id, project_id=project.id,
                           name=f"{project.name} voice"[:255], is_default=True)
        db.add(voice)
    if brand.get("tone"):
        voice.tone = _map_tone(brand["tone"])
    voice.voice_prompt = brand.get("voice_prompt") or voice.voice_prompt
    voice.vocabulary = brand.get("vocabulary") or voice.vocabulary
    voice.avoid_words = brand.get("avoid_words") or voice.avoid_words
    await db.flush()

    # 3. Knowledge base: one "profile" document, replaced on re-provisioning
    # so a second provision() call cannot pile up duplicate documents.
    #
    # Order matters: the new document is written FIRST, and the superseded
    # one is only removed once the new one is durably committed. If
    # add_document fails for any reason (transient DB error, etc.), the old
    # document is left untouched -- a re-provision failure must never leave
    # the project with fewer usable profile documents than it started with,
    # even though the write as a whole stays best-effort and must never fail
    # provision() itself.
    keys = await get_org_llm_keys(org_id, db)
    profile = _profile_document(r)
    if profile.strip() and keys.get("openai"):
        existing_doc = (await db.execute(
            select(ProjectDocument).where(
                ProjectDocument.project_id == project.id,
                ProjectDocument.org_id == org_id,
                ProjectDocument.kind == PROFILE_DOC_KIND,
            )
        )).scalars().first()
        try:
            await knowledge_service.add_document(
                project.id, org_id, title="Business profile", body=profile,
                kind=PROFILE_DOC_KIND, source=run.input_url, keys=keys, db=db)
        except Exception:
            pass  # knowledge is best-effort; never blocks provisioning -- the
                  # old document (if any) is still in place, so nothing is lost
        else:
            if existing_doc is not None:
                try:
                    await knowledge_service.delete_document(existing_doc.id, org_id, keys, db)
                except Exception:
                    pass  # a leftover duplicate is acceptable; data loss is not

    # 4. Employee memory. Stable `key`s mean a re-provision reinforces the
    # existing memory row instead of duplicating it (app/employees/memory.py).
    shared = []
    if brand.get("tone"):
        shared.append(("tone", f"Brand tone: {brand['tone']}"))
    if brand.get("mission"):
        shared.append(("mission", f"Mission: {brand['mission']}"))
    if r.get("goals"):
        shared.append(("goals", "Primary goals: " + ", ".join(r["goals"])))
    if brand.get("avoid_words"):
        shared.append(("avoid_words", "Never use: " + ", ".join(brand["avoid_words"])))
    # memory_layer.remember dedups on (org_id, employee_id, key) WITHOUT
    # project_id, so a bare key like "tone" would collide across projects in the
    # same org: onboarding a second workspace would overwrite the first
    # project's seeded memory in place (and leave the second with none). Since
    # onboarding is now the per-project creation path, namespace every seed key
    # by project id so each workspace keeps its own facts.
    kp = f"{project.id}:"
    for key, content in shared:
        await memory_layer.remember(db, org_id=org_id, project_id=project.id,
                                    employee_id="zerda", content=content,
                                    scope=SCOPE_PROJECT, kind="fact", key=f"{kp}{key}")
    if r.get("competitors"):
        names = ", ".join(c.get("name") or c.get("url") or "" for c in r["competitors"])
        if names:
            await memory_layer.remember(db, org_id=org_id, project_id=project.id,
                                        employee_id="sable", content=f"Known competitors: {names}",
                                        scope=SCOPE_PROJECT, kind="fact", key=f"{kp}competitors")
    if (r.get("seo") or {}).get("suggested_keywords"):
        kws = ", ".join(r["seo"]["suggested_keywords"])
        await memory_layer.remember(db, org_id=org_id, project_id=project.id,
                                    employee_id="zerda", content=f"Seed keywords: {kws}",
                                    scope=SCOPE_PROJECT, kind="fact", key=f"{kp}seed_keywords")

    await db.commit()
    return project.id
