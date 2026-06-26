import uuid
from enum import Enum as PyEnum
from sqlalchemy import String, ForeignKey, Text, Enum as SAEnum, JSON, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import TimestampMixin


class VoiceTone(str, PyEnum):
    professional = "professional"
    conversational = "conversational"
    authoritative = "authoritative"
    friendly = "friendly"
    technical = "technical"
    inspirational = "inspirational"


class BrandVoice(Base, TimestampMixin):
    __tablename__ = "brand_voices"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    tone: Mapped[VoiceTone] = mapped_column(SAEnum(VoiceTone, name="voice_tone_enum"), default=VoiceTone.professional)
    description: Mapped[str | None] = mapped_column(Text)          # human-written description
    voice_prompt: Mapped[str | None] = mapped_column(Text)          # AI-generated prompt fragment
    vocabulary: Mapped[list | None] = mapped_column(JSON)           # preferred words/phrases list
    avoid_words: Mapped[list | None] = mapped_column(JSON)          # words to avoid
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    training_sources: Mapped[list["BrandVoiceSource"]] = relationship(
        "BrandVoiceSource", back_populates="brand_voice", cascade="all, delete-orphan"
    )


class BrandVoiceSource(Base, TimestampMixin):
    __tablename__ = "brand_voice_sources"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    brand_voice_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("brand_voices.id", ondelete="CASCADE"), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)  # "url" or "text"
    content: Mapped[str] = mapped_column(Text, nullable=False)             # URL or raw text
    extracted_text: Mapped[str | None] = mapped_column(Text)               # fetched/cleaned content
    brand_voice: Mapped["BrandVoice"] = relationship("BrandVoice", back_populates="training_sources")
