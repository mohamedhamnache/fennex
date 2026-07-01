import io
import uuid
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, status
from PIL import Image as PILImage
from pydantic import BaseModel, ConfigDict, field_validator
from sqlalchemy import select

from app.core.dependencies import CurrentUser, DB
from app.core.storage import upload_bytes
from app.models.image import GeneratedImage
from app.services.editing_service import _download
from app.services.seo_service import generate_seo_data

router = APIRouter()

_FORMAT_PILLOW = {"png": "PNG", "jpg": "JPEG", "webp": "WEBP"}
_FORMAT_MIME = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


class ExportRequest(BaseModel):
    format: Literal["png", "jpg", "webp"] = "webp"
    quality: int = 85

    @field_validator("quality")
    @classmethod
    def quality_range(cls, v: int) -> int:
        if not (1 <= v <= 100):
            raise ValueError("quality must be between 1 and 100")
        return v


class ExportOut(BaseModel):
    download_url: str
    format: str
    size_bytes: int


class SeoOut(BaseModel):
    id: uuid.UUID
    alt_text: Optional[str] = None
    caption: Optional[str] = None
    seo_filename: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


async def _get_image_or_404(image_id: uuid.UUID, org_id: uuid.UUID, db) -> GeneratedImage:
    result = await db.execute(
        select(GeneratedImage).where(
            GeneratedImage.id == image_id,
            GeneratedImage.org_id == org_id,
        )
    )
    img = result.scalar_one_or_none()
    if img is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Image not found")
    return img


async def _convert_and_upload(image_url: str, fmt: str, quality: int, org_id: uuid.UUID) -> dict:
    data = await _download(image_url)
    pil = PILImage.open(io.BytesIO(data))
    if fmt != "png" and pil.mode == "RGBA":
        pil = pil.convert("RGB")
    buf = io.BytesIO()
    save_kwargs: dict = {"format": _FORMAT_PILLOW[fmt], "optimize": True}
    if fmt != "png":
        save_kwargs["quality"] = quality
    pil.save(buf, **save_kwargs)
    buf.seek(0)
    out_bytes = buf.read()
    key = f"exports/{org_id}/{uuid.uuid4().hex}.{fmt}"
    url = await upload_bytes(out_bytes, key, _FORMAT_MIME[fmt])
    return {"download_url": url, "size_bytes": len(out_bytes)}


@router.post("/{image_id}/seo", response_model=SeoOut)
async def generate_image_seo(image_id: uuid.UUID, current_user: CurrentUser, db: DB):
    img = await _get_image_or_404(image_id, current_user.org_id, db)

    seo = await generate_seo_data(img.prompt or "", img.usage or "article_cover", current_user.org_id, db)

    img.alt_text = seo.get("alt_text")
    img.caption = seo.get("caption")
    img.seo_filename = seo.get("seo_filename")
    await db.flush()
    await db.refresh(img)
    await db.commit()
    return SeoOut.model_validate(img)


@router.post("/{image_id}/export", response_model=ExportOut)
async def export_image(image_id: uuid.UUID, body: ExportRequest, current_user: CurrentUser, db: DB):
    img = await _get_image_or_404(image_id, current_user.org_id, db)
    if not img.image_url:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Image has no URL to export")

    result = await _convert_and_upload(img.image_url, body.format, body.quality, current_user.org_id)
    return ExportOut(download_url=result["download_url"], format=body.format, size_bytes=result["size_bytes"])
