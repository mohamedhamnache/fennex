import uuid
from enum import Enum as PyEnum
from sqlalchemy import String, ForeignKey, Text, Enum as SAEnum, Integer, JSON, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class ImageStyle(str, PyEnum):
    photorealistic = "photorealistic"
    illustration = "illustration"
    minimalist = "minimalist"
    abstract = "abstract"
    professional = "professional"
    three_d_render = "3d_render"
    anime = "anime"
    cinematic = "cinematic"
    luxury_product = "luxury_product"


class ImageStatus(str, PyEnum):
    pending = "pending"
    generating = "generating"
    ready = "ready"
    failed = "failed"


class ImageUsage(str, PyEnum):
    article_cover = "article_cover"
    social_post = "social_post"
    brand_asset = "brand_asset"
    custom = "custom"


class GeneratedImage(Base, TimestampMixin):
    __tablename__ = "generated_images"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    revised_prompt: Mapped[str | None] = mapped_column(Text)       # DALL-E's rewritten prompt
    style: Mapped[ImageStyle] = mapped_column(SAEnum(ImageStyle, name="image_style_enum"), default=ImageStyle.professional)
    usage: Mapped[ImageUsage] = mapped_column(SAEnum(ImageUsage, name="image_usage_enum"), default=ImageUsage.article_cover)
    status: Mapped[ImageStatus] = mapped_column(SAEnum(ImageStatus, name="image_status_enum"), default=ImageStatus.pending)
    image_url: Mapped[str | None] = mapped_column(Text)            # URL from DALL-E or placeholder
    thumbnail_url: Mapped[str | None] = mapped_column(Text)        # same as image_url for now
    width: Mapped[int] = mapped_column(Integer, default=1792)
    height: Mapped[int] = mapped_column(Integer, default=1024)
    article_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("articles.id", ondelete="SET NULL"), nullable=True)
    social_post_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("social_posts.id", ondelete="SET NULL"), nullable=True)
    generation_meta: Mapped[dict | None] = mapped_column(JSON)     # provider response metadata
    error: Mapped[str | None] = mapped_column(Text)
    cost_usd: Mapped[float | None] = mapped_column(Float)          # generation cost in USD
    source_image_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("generated_images.id", ondelete="SET NULL"), nullable=True
    )
    edit_operation: Mapped[str | None] = mapped_column(String(100), nullable=True)
