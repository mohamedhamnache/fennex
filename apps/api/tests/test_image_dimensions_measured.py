"""Stored image dimensions must describe the actual bytes.

21.4% of measurable rows (36 of 168) did not. The recorded size was whatever
had been ASKED for -- gpt-image-1 answers a 1080x1920 request with 1024x1536 --
or a hardcoded literal when the result carried no size, which stored every
500x500 remove.bg cutout as 1024x1024.

It was not a cosmetic defect. It made remove.bg look like it was cropping,
because a cutout's aspect disagreed with its parent's RECORDED aspect while
matching its parent's real one exactly, and an investigation went after a
supplier bug that did not exist.
"""
import base64
import io
import uuid

import pytest
from PIL import Image
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.database import Base
from app.models.image import GeneratedImage, ImageUsage

pytestmark = pytest.mark.asyncio

engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
Session = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as c:
        await c.run_sync(Base.metadata.drop_all)


def data_uri(w: int, h: int) -> str:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (10, 20, 30)).save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def make(**kw) -> GeneratedImage:
    return GeneratedImage(org_id=uuid.uuid4(), project_id=uuid.uuid4(),
                          prompt="p", usage=ImageUsage.custom, **kw)


async def test_requested_dimensions_are_overwritten_by_the_real_ones():
    """The exact production case: 1080x1920 asked for, 1024x1536 returned."""
    img = make(image_url=data_uri(1024, 1536), width=1080, height=1920)
    async with Session() as db:
        db.add(img)
        await db.commit()
        assert (img.width, img.height) == (1024, 1536)


async def test_a_hardcoded_default_cannot_survive_either():
    """remove.bg cutouts are 0.25 MP; every one was stored as 1024x1024
    because the caller defaulted to a literal when the result had no size."""
    img = make(image_url=data_uri(500, 500), width=1024, height=1024)
    async with Session() as db:
        db.add(img)
        await db.commit()
        assert (img.width, img.height) == (500, 500)


async def test_correct_dimensions_are_left_alone():
    img = make(image_url=data_uri(800, 600), width=800, height=600)
    async with Session() as db:
        db.add(img)
        await db.commit()
        assert (img.width, img.height) == (800, 600)


async def test_replacing_the_bytes_updates_the_dimensions():
    """An edit that changes size must not leave the old size behind -- the
    upscale case that first exposed this."""
    img = make(image_url=data_uri(512, 512), width=512, height=512)
    async with Session() as db:
        db.add(img)
        await db.commit()
        img.image_url = data_uri(1024, 1024)
        await db.commit()
        assert (img.width, img.height) == (1024, 1024)


async def test_a_remote_url_keeps_the_supplied_dimensions():
    """The hook never fetches: an ORM flush is no place for network I/O, so an
    externally-hosted image keeps whatever the caller provided."""
    img = make(image_url="https://example.com/x.png", width=1234, height=567)
    async with Session() as db:
        db.add(img)
        await db.commit()
        assert (img.width, img.height) == (1234, 567)


async def test_unreadable_bytes_do_not_break_the_insert():
    """Corrupt base64 must not cost the user their image record."""
    img = make(image_url="data:image/png;base64,not-actually-an-image",
               width=640, height=480)
    async with Session() as db:
        db.add(img)
        await db.commit()
        assert (img.width, img.height) == (640, 480)


async def test_the_aspect_ratio_anomaly_cannot_recur():
    """The bug that sent an investigation after a supplier that was innocent.

    A parent recorded as 1792x1024 (aspect 1.75) was really 2080x1664 (1.25).
    Its 0.25 MP cutout at 559x447 is aspect 1.251 -- which looked like the
    supplier had cropped, and in fact matched the parent's TRUE aspect.
    """
    parent = make(image_url=data_uri(2080, 1664), width=1792, height=1024)
    async with Session() as db:
        db.add(parent)
        await db.commit()
        cutout = make(image_url=data_uri(559, 447), width=559, height=447,
                      source_image_id=parent.id)
        db.add(cutout)
        await db.commit()

        parent_aspect = parent.width / parent.height
        cutout_aspect = cutout.width / cutout.height
        assert abs(parent_aspect - cutout_aspect) < 0.01, (
            "with both measured, parent and cutout agree and nothing looks cropped"
        )
