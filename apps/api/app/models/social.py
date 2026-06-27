import uuid
from enum import Enum as PyEnum
from sqlalchemy import String, ForeignKey, Text, Enum as SAEnum, Integer, Boolean, JSON, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import TimestampMixin


class SocialPlatform(str, PyEnum):
    linkedin = "linkedin"
    twitter = "twitter"
    instagram = "instagram"
    facebook = "facebook"


class SocialPostStatus(str, PyEnum):
    draft = "draft"
    scheduled = "scheduled"
    published = "published"
    failed = "failed"


class SocialPostType(str, PyEnum):
    article_share = "article_share"     # share a published article
    tip = "tip"                          # quick tip/insight
    question = "question"                # engagement question
    announcement = "announcement"        # product/company announcement


class SocialPost(Base, TimestampMixin):
    __tablename__ = "social_posts"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    platform: Mapped[SocialPlatform] = mapped_column(SAEnum(SocialPlatform, name="social_platform_enum"), nullable=False)
    post_type: Mapped[SocialPostType] = mapped_column(SAEnum(SocialPostType, name="social_post_type_enum"), default=SocialPostType.article_share)
    status: Mapped[SocialPostStatus] = mapped_column(SAEnum(SocialPostStatus, name="social_post_status_enum"), default=SocialPostStatus.draft)
    content: Mapped[str] = mapped_column(Text, nullable=False)               # the post text
    hashtags: Mapped[list | None] = mapped_column(JSON)                      # ["#seo", "#marketing"]
    media_urls: Mapped[list | None] = mapped_column(JSON)                    # image/video URLs
    scheduled_at: Mapped[str | None] = mapped_column(String(50))             # ISO timestamp
    published_at: Mapped[str | None] = mapped_column(String(50))             # ISO timestamp
    article_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("articles.id", ondelete="SET NULL"), nullable=True)
    engagement_stats: Mapped[dict | None] = mapped_column(JSON)              # {likes, shares, comments, clicks}
    error: Mapped[str | None] = mapped_column(Text)
    char_count: Mapped[int] = mapped_column(Integer, default=0)


class SocialConnection(Base, TimestampMixin):
    __tablename__ = "social_connections"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    platform: Mapped[SocialPlatform] = mapped_column(
        SAEnum(SocialPlatform, name="social_platform_enum"), nullable=False
    )
    handle: Mapped[str | None] = mapped_column(String(200))          # @username or page name
    encrypted_token: Mapped[str] = mapped_column(Text, nullable=False)

    __table_args__ = (
        UniqueConstraint("org_id", "platform", name="uq_social_connection_org_platform"),
    )
