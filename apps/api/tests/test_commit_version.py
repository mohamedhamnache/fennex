"""Committing an edited version onto the image itself.

Every edit writes a CHILD row and the gallery hides children, so edits were
stored and then invisible: the library kept showing the untouched original and
reopening the editor loaded it back. "Done" was pure navigation and saved
nothing.
"""
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base, get_db
from app.core.dependencies import get_current_user
from app.main import app
from app.models.image import GeneratedImage, ImageStatus
from app.models.organization import Organization
from app.models.project import Project
from app.models.user import User

_engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
_Session = async_sessionmaker(_engine, expire_on_commit=False, class_=AsyncSession)

_ORG = uuid.uuid4()
_OTHER_ORG = uuid.uuid4()
_PROJECT = uuid.uuid4()
_SRC = uuid.uuid4()
_VERSION = uuid.uuid4()
_FOREIGN = uuid.uuid4()
_UNRELATED = uuid.uuid4()


async def _override_get_db():
    async with _Session() as s:
        yield s


def _override_get_current_user():
    return User(id=uuid.uuid4(), org_id=_ORG, email="a@b.c", full_name="A", hashed_password="x")


@pytest.fixture
async def client():
    async with _engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    async with _Session() as s:
        s.add(Organization(id=_ORG, slug="o", name="O"))
        s.add(Organization(id=_OTHER_ORG, slug="o2", name="O2"))
        s.add(Project(id=_PROJECT, org_id=_ORG, name="P", domain="p.example"))
        s.add(GeneratedImage(id=_SRC, org_id=_ORG, project_id=_PROJECT, prompt="p",
                             status=ImageStatus.ready, image_url="https://cdn/original.png",
                             width=800, height=600))
        s.add(GeneratedImage(id=_VERSION, org_id=_ORG, project_id=_PROJECT, prompt="p",
                             status=ImageStatus.ready, image_url="https://cdn/edited.png",
                             thumbnail_url="https://cdn/edited.png",
                             width=1600, height=1200, source_image_id=_SRC,
                             edit_operation="upscale"))
        # a version of a DIFFERENT image, in the same org
        s.add(GeneratedImage(id=_UNRELATED, org_id=_ORG, project_id=_PROJECT, prompt="p",
                             status=ImageStatus.ready, image_url="https://cdn/other.png",
                             width=100, height=100, source_image_id=uuid.uuid4()))
        # an image belonging to another org entirely
        s.add(GeneratedImage(id=_FOREIGN, org_id=_OTHER_ORG, project_id=_PROJECT, prompt="p",
                             status=ImageStatus.ready, image_url="https://cdn/foreign.png",
                             width=10, height=10))
        await s.commit()

    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = _override_get_current_user
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
            yield ac
    finally:
        app.dependency_overrides.clear()
        async with _engine.begin() as c:
            await c.run_sync(Base.metadata.drop_all)


async def _commit(client, image_id, version_id):
    return await client.post(f"/api/v1/images/{image_id}/commit-version",
                             json={"version_id": str(version_id)})


async def test_the_image_becomes_the_edited_version(client):
    resp = await _commit(client, _SRC, _VERSION)
    assert resp.status_code == 200, resp.text

    async with _Session() as s:
        src = (await s.execute(select(GeneratedImage).where(GeneratedImage.id == _SRC))).scalar_one()
        assert src.image_url == "https://cdn/edited.png"
        assert src.thumbnail_url == "https://cdn/edited.png"
        # carried because edits legitimately change them
        assert (src.width, src.height) == (1600, 1200)
        assert src.edit_operation == "upscale"


async def test_history_is_not_destroyed(client):
    await _commit(client, _SRC, _VERSION)
    async with _Session() as s:
        version = (await s.execute(
            select(GeneratedImage).where(GeneratedImage.id == _VERSION))).scalar_one()
        assert version.source_image_id == _SRC, "the version row must survive"


async def test_a_version_of_another_image_is_refused(client):
    """Otherwise one member could graft an unrelated picture onto an image."""
    resp = await _commit(client, _SRC, _UNRELATED)
    assert resp.status_code == 422

    async with _Session() as s:
        src = (await s.execute(select(GeneratedImage).where(GeneratedImage.id == _SRC))).scalar_one()
        assert src.image_url == "https://cdn/original.png", "must not have been touched"


async def test_an_image_from_another_org_is_not_reachable(client):
    resp = await _commit(client, _SRC, _FOREIGN)
    assert resp.status_code == 404


async def test_committing_a_foreign_image_itself_is_not_reachable(client):
    resp = await _commit(client, _FOREIGN, _VERSION)
    assert resp.status_code == 404
