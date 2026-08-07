import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.core.security import encrypt_value
from app.employees import memory as memory_layer
from app.models.api_key import APIKey
from app.models.brand_kit import BrandKit
from app.models.brand_voice import BrandVoice, VoiceTone
from app.models.discovery import DiscoveryRun
from app.models.employee_memory import EmployeeMemory
from app.models.knowledge import ProjectDocument
from app.models.organization import Organization
from app.models.project import Project
from app.services import knowledge_service, workspace_provisioning_service as prov

test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
TestSessionLocal = async_sessionmaker(test_engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Never let a test touch the network via embeddings or memory writes'
    optional vector backend -- assert on call args instead of letting real
    work happen."""
    calls = {"add_document": [], "delete_document": [], "remember": []}

    async def fake_add_document(project_id, org_id, *, title, body, kind, source, keys, db):
        # Mirrors the real knowledge_service.add_document closely enough to
        # catch a wrong project_id/org_id/kind filter elsewhere in the
        # provisioning service: it actually inserts a row, so a broken filter
        # that fails to find/delete the superseded document leaves a real
        # extra ProjectDocument behind for the idempotency test to see.
        calls["add_document"].append(dict(
            project_id=project_id, org_id=org_id, title=title, body=body,
            kind=kind, source=source, keys=keys))
        doc = ProjectDocument(org_id=org_id, project_id=project_id, title=title,
                              kind=kind, source=source, body=body,
                              word_count=len(body.split()), status="ready")
        db.add(doc)
        await db.flush()
        return doc

    async def fake_delete_document(document_id, org_id, keys, db):
        # Mirrors the real knowledge_service.delete_document: actually
        # removes the row (scoped to org_id), rather than a no-op that would
        # let a duplicate silently survive.
        calls["delete_document"].append(dict(document_id=document_id, org_id=org_id))
        doc = await db.get(ProjectDocument, document_id)
        if doc is None or doc.org_id != org_id:
            return False
        await db.delete(doc)
        await db.flush()
        return True

    real_remember = memory_layer.remember

    async def spying_remember(db, **kwargs):
        calls["remember"].append(kwargs)
        return await real_remember(db, **kwargs)

    monkeypatch.setattr(knowledge_service, "add_document", fake_add_document)
    monkeypatch.setattr(knowledge_service, "delete_document", fake_delete_document)
    monkeypatch.setattr(memory_layer, "remember", spying_remember)
    return calls


async def _seed_org(slug: str, with_openai_key: bool = True) -> uuid.UUID:
    org_id = uuid.uuid4()
    async with TestSessionLocal() as db:
        # byok_enabled mirrors with_openai_key: platform-first resolution only
        # surfaces this tenant key when the org has opted into BYOK.
        db.add(Organization(id=org_id, slug=slug, name=slug, byok_enabled=with_openai_key))
        if with_openai_key:
            db.add(APIKey(org_id=org_id, provider="openai", encrypted_value=encrypt_value("sk-test")))
        await db.commit()
    return org_id


async def _seed_run(org_id: uuid.UUID, result: dict, url: str | None = "https://acme.test",
                    description: str | None = None) -> uuid.UUID:
    run_id = uuid.uuid4()
    async with TestSessionLocal() as db:
        db.add(DiscoveryRun(id=run_id, org_id=org_id, input_url=url,
                            input_description=description, result=result))
        await db.commit()
    return run_id


ACME_RESULT = {
    "business": {"name": "Acme Cafe", "domain": "https://acme.test",
                "industry": "Coffee", "language": "en", "country": "FR",
                "socials": {"instagram": "https://instagram.com/acme"},
                "description": "We roast coffee."},
    "brand": {"colors": ["#7C3AED"], "tone": "warm", "primary_font": "DM Sans",
             "vocabulary": ["artisan"], "avoid_words": ["cheap"], "voice_prompt": "Be warm."},
    "products": [], "audience": [{"label": "Locals"}],
    "competitors": [{"url": "https://rival.test", "name": "Rival"}],
    "seo": {"score": 72, "suggested_keywords": ["specialty coffee lyon"]},
    "goals": ["Increase SEO traffic"], "success_metrics": ["Organic traffic"],
}


async def test_provision_creates_project_and_brand():
    org_id = await _seed_org("acme")
    run_id = await _seed_run(org_id, ACME_RESULT)

    async with TestSessionLocal() as db:
        pid = await prov.provision(run_id, persona="ecommerce", db=db)

        project = await db.get(Project, pid)
        assert project.name == "Acme Cafe"
        assert project.industry == "Coffee"
        assert project.domain == "https://acme.test"
        assert project.locale == "en"
        assert project.target_country == "FR"
        assert project.persona == "ecommerce"

        kit = (await db.execute(
            select(BrandKit).where(BrandKit.project_id == pid)
        )).scalar_one()
        assert "#7C3AED" in kit.colors

        # Idempotent: second run does not create a duplicate project.
        pid2 = await prov.provision(run_id, persona="ecommerce", db=db)
        assert pid2 == pid

        project_count = (await db.execute(
            select(Project).where(Project.org_id == org_id)
        )).scalars().all()
        assert len(project_count) == 1


async def test_provision_is_idempotent_on_reprovision(no_network):
    """Re-provisioning the same run must update the existing rows across all
    five stores rather than creating duplicates."""
    org_id = await _seed_org("acme-repro")
    run_id = await _seed_run(org_id, ACME_RESULT)

    async with TestSessionLocal() as db:
        pid1 = await prov.provision(run_id, persona="ecommerce", db=db)
        pid2 = await prov.provision(run_id, persona="ecommerce", db=db)
        assert pid1 == pid2

        voices = (await db.execute(
            select(BrandVoice).where(BrandVoice.project_id == pid1)
        )).scalars().all()
        assert len(voices) == 1

        kits = (await db.execute(
            select(BrandKit).where(BrandKit.project_id == pid1)
        )).scalars().all()
        assert len(kits) == 1

        memories = (await db.execute(
            select(EmployeeMemory).where(EmployeeMemory.project_id == pid1, EmployeeMemory.key == f"{pid1}:competitors")
        )).scalars().all()
        assert len(memories) == 1

        # Knowledge-store idempotency: the fakes above actually insert/delete
        # rows (unlike a stub that always returns True), so this catches a
        # provisioning-service filter bug directly. If the existing-document
        # lookup in provision() used the wrong project_id/org_id/kind (e.g.
        # matched on kind="note" instead of PROFILE_DOC_KIND, or omitted the
        # project_id filter), the superseded document from the first
        # provision() call would never be found and never deleted, and the
        # second call's add_document would insert a second row -- this
        # assertion would then see 2 documents instead of 1 and fail.
        docs = (await db.execute(
            select(ProjectDocument).where(
                ProjectDocument.project_id == pid1, ProjectDocument.kind == "profile")
        )).scalars().all()
        assert len(docs) == 1


async def test_free_text_tone_maps_onto_closed_enum(no_network):
    """BrandVoice.tone is a closed SQLAlchemy enum. Discovery's brand.tone is
    free LLM text ("warm") that is not a member, so it must fall back to
    VoiceTone.professional rather than failing at flush."""
    org_id = await _seed_org("tone-org")
    result = dict(ACME_RESULT, brand=dict(ACME_RESULT["brand"], tone="warm"))
    run_id = await _seed_run(org_id, result)

    async with TestSessionLocal() as db:
        pid = await prov.provision(run_id, persona=None, db=db)
        voice = (await db.execute(
            select(BrandVoice).where(BrandVoice.project_id == pid)
        )).scalar_one()
        assert voice.tone == VoiceTone.professional


async def test_free_text_tone_exact_match_is_used(no_network):
    """A discovery tone that IS a member of the enum (case-insensitively)
    should map onto that member rather than the professional fallback."""
    org_id = await _seed_org("tone-org-2")
    result = dict(ACME_RESULT, brand=dict(ACME_RESULT["brand"], tone="Friendly"))
    run_id = await _seed_run(org_id, result)

    async with TestSessionLocal() as db:
        pid = await prov.provision(run_id, persona=None, db=db)
        voice = (await db.execute(
            select(BrandVoice).where(BrandVoice.project_id == pid)
        )).scalar_one()
        assert voice.tone == VoiceTone.friendly


async def test_description_only_run_without_domain(no_network):
    """A description-only onboarding has no input_url and no discovered
    domain. Project.domain is NOT NULL, so provisioning must fabricate a
    fallback instead of raising at flush."""
    org_id = await _seed_org("no-domain-org")
    result = {
        "business": {"name": "Boutique Bakery", "domain": None, "industry": None,
                    "language": None, "country": None, "socials": {},
                    "description": "A boutique bakery in Nice."},
        "brand": {"colors": [], "tone": None},
        "products": [], "audience": [], "competitors": [],
        "seo": {"suggested_keywords": []},
        "goals": [], "success_metrics": [],
    }
    run_id = await _seed_run(org_id, result, url=None, description="A boutique bakery in Nice.")

    async with TestSessionLocal() as db:
        pid = await prov.provision(run_id, persona="creator", db=db)
        project = await db.get(Project, pid)
        assert project.name == "Boutique Bakery"
        assert project.domain  # non-null, non-empty fallback
        assert project.domain != "None"


async def test_knowledge_document_written_with_expected_body(no_network):
    org_id = await _seed_org("kb-org")
    run_id = await _seed_run(org_id, ACME_RESULT)

    async with TestSessionLocal() as db:
        await prov.provision(run_id, persona=None, db=db)

    assert len(no_network["add_document"]) == 1
    call = no_network["add_document"][0]
    assert call["kind"] == "profile"
    assert "Acme Cafe" in call["body"]
    assert "We roast coffee." in call["body"]


async def test_add_document_failure_preserves_existing_document(monkeypatch, no_network):
    """If add_document fails on a re-provision (transient DB error, etc.),
    the previously-written profile document must survive untouched and
    provision() must still succeed -- never leave the project with zero
    profile documents."""
    org_id = await _seed_org("kb-fail-org")
    run_id = await _seed_run(org_id, ACME_RESULT)

    async with TestSessionLocal() as db:
        pid = await prov.provision(run_id, persona=None, db=db)

        docs_before = (await db.execute(
            select(ProjectDocument).where(
                ProjectDocument.project_id == pid, ProjectDocument.kind == "profile")
        )).scalars().all()
        assert len(docs_before) == 1
        original_doc_id = docs_before[0].id

        async def failing_add_document(*args, **kwargs):
            raise RuntimeError("transient db error")

        monkeypatch.setattr(knowledge_service, "add_document", failing_add_document)

        # Must not raise even though the knowledge write fails.
        pid2 = await prov.provision(run_id, persona=None, db=db)
        assert pid2 == pid

        docs_after = (await db.execute(
            select(ProjectDocument).where(
                ProjectDocument.project_id == pid, ProjectDocument.kind == "profile")
        )).scalars().all()
        assert len(docs_after) == 1
        assert docs_after[0].id == original_doc_id


async def test_knowledge_write_skipped_without_org_keys(no_network):
    """No OpenAI key on the org -> skip the knowledge write rather than
    calling add_document (and never raise)."""
    from unittest.mock import patch as _patch
    from app.core.config import settings

    org_id = await _seed_org("no-key-org", with_openai_key=False)
    run_id = await _seed_run(org_id, ACME_RESULT)

    # The org has no key; the PLATFORM may still have one, and the service
    # correctly falls back to it. Clearing it is what makes this a test of
    # "no keys" rather than of "no tenant keys in an empty environment".
    with _patch.object(settings, "OPENAI_API_KEY", None):
        async with TestSessionLocal() as db:
            await prov.provision(run_id, persona=None, db=db)

    assert no_network["add_document"] == []


async def test_employee_memory_seeded(no_network):
    org_id = await _seed_org("mem-org")
    run_id = await _seed_run(org_id, ACME_RESULT)

    async with TestSessionLocal() as db:
        pid = await prov.provision(run_id, persona=None, db=db)

        # Seed keys are namespaced by project id so a second workspace in the
        # same org cannot overwrite this project's memory.
        suffixes = {call["key"].split(":", 1)[-1] for call in no_network["remember"]}
        assert {"tone", "goals", "avoid_words", "competitors", "seed_keywords"} <= suffixes
        assert all(call["key"].startswith(f"{pid}:") for call in no_network["remember"])

        competitor_memory = (await db.execute(
            select(EmployeeMemory).where(
                EmployeeMemory.project_id == pid, EmployeeMemory.key == f"{pid}:competitors"
            )
        )).scalar_one()
        assert "Rival" in competitor_memory.content
        assert competitor_memory.employee_id == "sable"


async def test_two_workspaces_same_org_keep_separate_memory(no_network):
    """Regression: onboarding a second workspace in the same org must not
    overwrite the first project's seeded memory (memory.remember dedups on
    (org_id, employee_id, key), so seed keys are namespaced by project id)."""
    org_id = await _seed_org("multi-ws-org")
    run_a = await _seed_run(org_id, ACME_RESULT, url="https://acme-a.test")
    run_b = await _seed_run(org_id, ACME_RESULT, url="https://acme-b.test")

    async with TestSessionLocal() as db:
        pid_a = await prov.provision(run_a, persona=None, db=db)
        pid_b = await prov.provision(run_b, persona=None, db=db)
        assert pid_a != pid_b

        # Each project must have its OWN tone memory, with its own project_id.
        for pid in (pid_a, pid_b):
            tone = (await db.execute(
                select(EmployeeMemory).where(
                    EmployeeMemory.project_id == pid, EmployeeMemory.key == f"{pid}:tone"
                )
            )).scalar_one()
            assert tone.project_id == pid
