import uuid
from datetime import datetime
from typing import Optional

import httpx
from bs4 import BeautifulSoup
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.core.dependencies import CurrentUser, DB
from app.models.brand_voice import BrandVoice, BrandVoiceSource, VoiceTone

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class BrandVoiceOut(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    name: str
    tone: str
    description: Optional[str]
    voice_prompt: Optional[str]
    vocabulary: Optional[list]
    avoid_words: Optional[list]
    is_default: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class BrandVoiceSourceOut(BaseModel):
    id: uuid.UUID
    brand_voice_id: uuid.UUID
    source_type: str
    content: str
    extracted_text: Optional[str]
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class CreateBrandVoiceRequest(BaseModel):
    name: str
    tone: Optional[VoiceTone] = VoiceTone.professional
    description: Optional[str] = None
    vocabulary: Optional[list[str]] = None
    avoid_words: Optional[list[str]] = None


class UpdateBrandVoiceRequest(BaseModel):
    name: Optional[str] = None
    tone: Optional[VoiceTone] = None
    description: Optional[str] = None
    vocabulary: Optional[list[str]] = None
    avoid_words: Optional[list[str]] = None
    voice_prompt: Optional[str] = None


class AddSourceRequest(BaseModel):
    source_type: str  # "url" or "text"
    content: str


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_voice_or_404(voice_id: uuid.UUID, org_id: uuid.UUID, db) -> BrandVoice:
    result = await db.execute(
        select(BrandVoice)
        .options(selectinload(BrandVoice.training_sources))
        .where(BrandVoice.id == voice_id, BrandVoice.org_id == org_id)
    )
    voice = result.scalar_one_or_none()
    if voice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Brand voice not found")
    return voice


async def _fetch_and_extract(url: str) -> Optional[str]:
    """Fetch URL and extract body text via BeautifulSoup. Returns None on failure."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, follow_redirects=True)
            resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        # Remove script and style tags
        for tag in soup(["script", "style"]):
            tag.decompose()
        body = soup.get_text(separator=" ", strip=True)
        return body or None
    except Exception:
        return None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("", status_code=201, response_model=BrandVoiceOut)
async def create_brand_voice(
    body: CreateBrandVoiceRequest,
    current_user: CurrentUser,
    db: DB,
):
    # Check if this is the first voice (to set is_default)
    count_result = await db.execute(
        select(BrandVoice).where(BrandVoice.org_id == current_user.org_id)
    )
    existing = count_result.scalars().all()
    is_first = len(existing) == 0

    voice = BrandVoice(
        org_id=current_user.org_id,
        name=body.name,
        tone=body.tone or VoiceTone.professional,
        description=body.description,
        vocabulary=body.vocabulary,
        avoid_words=body.avoid_words,
        is_default=is_first,
    )
    db.add(voice)
    await db.flush()
    await db.refresh(voice)
    await db.commit()

    # Re-fetch with sources loaded
    result = await db.execute(
        select(BrandVoice)
        .options(selectinload(BrandVoice.training_sources))
        .where(BrandVoice.id == voice.id)
    )
    voice = result.scalar_one()
    return BrandVoiceOut.model_validate(voice)


@router.get("", response_model=list[BrandVoiceOut])
async def list_brand_voices(
    current_user: CurrentUser,
    db: DB,
):
    result = await db.execute(
        select(BrandVoice)
        .options(selectinload(BrandVoice.training_sources))
        .where(BrandVoice.org_id == current_user.org_id)
        .order_by(BrandVoice.created_at.desc())
    )
    voices = result.scalars().all()
    return [BrandVoiceOut.model_validate(v) for v in voices]


@router.get("/{voice_id}", response_model=BrandVoiceOut)
async def get_brand_voice(
    voice_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    voice = await _get_voice_or_404(voice_id, current_user.org_id, db)
    return BrandVoiceOut.model_validate(voice)


@router.patch("/{voice_id}", response_model=BrandVoiceOut)
async def update_brand_voice(
    voice_id: uuid.UUID,
    body: UpdateBrandVoiceRequest,
    current_user: CurrentUser,
    db: DB,
):
    voice = await _get_voice_or_404(voice_id, current_user.org_id, db)

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(voice, field, value)

    await db.flush()
    await db.refresh(voice)
    await db.commit()
    return BrandVoiceOut.model_validate(voice)


@router.delete("/{voice_id}", status_code=204)
async def delete_brand_voice(
    voice_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    voice = await _get_voice_or_404(voice_id, current_user.org_id, db)
    await db.delete(voice)
    await db.commit()
    return None


@router.post("/{voice_id}/set-default", response_model=BrandVoiceOut)
async def set_default_brand_voice(
    voice_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    voice = await _get_voice_or_404(voice_id, current_user.org_id, db)

    # Clear is_default on all other voices in org
    await db.execute(
        update(BrandVoice)
        .where(BrandVoice.org_id == current_user.org_id, BrandVoice.id != voice_id)
        .values(is_default=False)
    )
    voice.is_default = True
    await db.flush()
    await db.refresh(voice)
    await db.commit()
    return BrandVoiceOut.model_validate(voice)


@router.post("/{voice_id}/sources", status_code=201, response_model=BrandVoiceSourceOut)
async def add_brand_voice_source(
    voice_id: uuid.UUID,
    body: AddSourceRequest,
    current_user: CurrentUser,
    db: DB,
):
    voice = await _get_voice_or_404(voice_id, current_user.org_id, db)

    if body.source_type not in ("url", "text"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source_type must be 'url' or 'text'",
        )

    extracted_text: Optional[str] = None

    if body.source_type == "url":
        extracted_text = await _fetch_and_extract(body.content)
    else:
        # For text sources, store content directly as extracted_text
        extracted_text = body.content

    source = BrandVoiceSource(
        brand_voice_id=voice.id,
        org_id=current_user.org_id,
        source_type=body.source_type,
        content=body.content,
        extracted_text=extracted_text,
    )
    db.add(source)
    await db.flush()
    await db.refresh(source)
    await db.commit()
    return BrandVoiceSourceOut.model_validate(source)


@router.delete("/{voice_id}/sources/{source_id}", status_code=204)
async def delete_brand_voice_source(
    voice_id: uuid.UUID,
    source_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    # Verify voice belongs to org
    await _get_voice_or_404(voice_id, current_user.org_id, db)

    result = await db.execute(
        select(BrandVoiceSource).where(
            BrandVoiceSource.id == source_id,
            BrandVoiceSource.brand_voice_id == voice_id,
            BrandVoiceSource.org_id == current_user.org_id,
        )
    )
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Source not found")

    await db.delete(source)
    await db.commit()
    return None


@router.post("/{voice_id}/generate-prompt")
async def generate_voice_prompt(
    voice_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
):
    voice = await _get_voice_or_404(voice_id, current_user.org_id, db)

    # Build prompt from tone, description, vocabulary, avoid_words
    parts = [f"Write in a {voice.tone.value if hasattr(voice.tone, 'value') else voice.tone} tone."]

    if voice.description:
        parts.append(voice.description + ".")

    if voice.vocabulary:
        vocab_sample = ", ".join(voice.vocabulary[:10])
        parts.append(f"Use words like: {vocab_sample}.")

    if voice.avoid_words:
        avoid_sample = ", ".join(voice.avoid_words[:10])
        parts.append(f"Avoid: {avoid_sample}.")

    # Append style examples from training sources
    if voice.training_sources:
        examples = []
        for src in voice.training_sources:
            text = src.extracted_text
            if text:
                examples.append(text[:500])
        if examples:
            joined = " | ".join(examples)
            parts.append(f"Match the style of the following examples: {joined}")

    voice_prompt = " ".join(parts)
    voice.voice_prompt = voice_prompt

    await db.flush()
    await db.refresh(voice)
    await db.commit()

    return {"voice_id": str(voice.id), "voice_prompt": voice_prompt}
