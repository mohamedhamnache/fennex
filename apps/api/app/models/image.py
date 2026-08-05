import uuid
from enum import Enum as PyEnum
from sqlalchemy import String, ForeignKey, Text, Enum as SAEnum, Integer, JSON, Float, Boolean, event
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
    product_shot = "product_shot"
    marketing_banner = "marketing_banner"
    custom = "custom"


class SocialPreset(str, PyEnum):
    instagram_post    = "instagram_post"
    instagram_story   = "instagram_story"
    instagram_reel    = "instagram_reel"
    youtube_thumbnail = "youtube_thumbnail"
    linkedin_banner   = "linkedin_banner"
    linkedin_post     = "linkedin_post"
    facebook_ad       = "facebook_ad"
    tiktok_cover      = "tiktok_cover"
    pinterest_pin     = "pinterest_pin"


class GeneratedImage(Base, TimestampMixin):
    __tablename__ = "generated_images"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    revised_prompt: Mapped[str | None] = mapped_column(Text)       # DALL-E's rewritten prompt
    style: Mapped[ImageStyle] = mapped_column(SAEnum(ImageStyle, name="image_style_enum", values_callable=lambda x: [e.value for e in x]), default=ImageStyle.professional)
    usage: Mapped[ImageUsage] = mapped_column(SAEnum(ImageUsage, name="image_usage_enum", values_callable=lambda x: [e.value for e in x]), default=ImageUsage.article_cover)
    status: Mapped[ImageStatus] = mapped_column(SAEnum(ImageStatus, name="image_status_enum", values_callable=lambda x: [e.value for e in x]), default=ImageStatus.pending)
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
    alt_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    seo_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    social_platform: Mapped[str | None] = mapped_column(String(60), nullable=True)
    banner_format: Mapped[str | None] = mapped_column(String(60), nullable=True)
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("image_folders.id", ondelete="SET NULL"), nullable=True
    )
    collection_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("image_collections.id", ondelete="SET NULL"), nullable=True
    )
    tags: Mapped[list] = mapped_column(JSON, default=list, nullable=False, server_default="[]")
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")


# ---------------------------------------------------------------------------
# Recorded dimensions must be MEASURED, never requested
# ---------------------------------------------------------------------------
#
# 21.4% of stored images (36 of 168, measured 2026-08-05) had width/height that
# did not match their own bytes. Two ways it happened, in every case a value
# nobody checked against the file:
#
#   * the REQUESTED size was recorded rather than what the model returned --
#     gpt-image-1 answers a 1080x1920 request with 1024x1536, and a 1536x1024
#     request with 1440x960;
#   * a hardcoded literal was used when the result reported no size, so
#     remove.bg cutouts that are really 500x500 were all stored as 1024x1024.
#
# This cost real debugging time: it made remove.bg look like it was CROPPING
# (a cutout's aspect disagreed with its parent's *recorded* aspect, while
# agreeing exactly with its parent's real one) and sent an investigation after
# a supplier bug that did not exist.
#
# Fixing the ~8 call sites would fix today's bugs and not tomorrow's. This is a
# chokepoint instead, for the same reason the metering leak argued for one: a
# rule that depends on every future caller remembering it is a rule that gets
# broken. Anything that can measure its own bytes now does, whatever code path
# created it.
#
# Deliberately narrow: it only reads a base64 data URI, which is already in
# memory. It never fetches a remote URL -- an ORM flush hook is no place for
# network I/O -- so externally-hosted images keep whatever the caller supplied.
def _measure_stored_dimensions(_mapper, _connection, target: "GeneratedImage") -> None:
    url = target.image_url
    if not url or not url.startswith("data:"):
        return
    try:
        import base64
        import io
        from PIL import Image as _PILImage

        raw = base64.b64decode(url.split(",", 1)[1])
        # PIL parses only the header here; it never decodes pixel data.
        width, height = _PILImage.open(io.BytesIO(raw)).size
    except Exception:
        return  # Unreadable bytes are not this hook's problem to report.
    if width > 0 and height > 0:
        target.width, target.height = width, height


event.listen(GeneratedImage, "before_insert", _measure_stored_dimensions)
event.listen(GeneratedImage, "before_update", _measure_stored_dimensions)
