import uuid
from enum import Enum as PyEnum
from sqlalchemy import String, ForeignKey, Text, Enum as SAEnum, Integer, JSON, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import TimestampMixin


class ArticleStatus(str, PyEnum):
    draft = "draft"
    generating = "generating"
    ready = "ready"
    published = "published"
    failed = "failed"


class Article(Base, TimestampMixin):
    __tablename__ = "articles"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    target_keyword: Mapped[str | None] = mapped_column(String(500))
    tone: Mapped[str] = mapped_column(String(100), default="professional")
    status: Mapped[ArticleStatus] = mapped_column(SAEnum(ArticleStatus, name="article_status_enum"), default=ArticleStatus.draft)
    body_markdown: Mapped[str | None] = mapped_column(Text)
    body_html: Mapped[str | None] = mapped_column(Text)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    word_count_target: Mapped[int] = mapped_column(Integer, default=1500)
    seo_score: Mapped[float | None] = mapped_column(Float)
    meta_title: Mapped[str | None] = mapped_column(String(500))
    meta_description: Mapped[str | None] = mapped_column(Text)
    outline: Mapped[dict | None] = mapped_column(JSON)
    brand_voice_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("brand_voices.id"), nullable=True)
    content_item_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("content_items.id"), nullable=True)
    error: Mapped[str | None] = mapped_column(Text)
    revisions: Mapped[list["ArticleRevision"]] = relationship("ArticleRevision", back_populates="article", cascade="all, delete-orphan")


class ArticleRevision(Base, TimestampMixin):
    __tablename__ = "article_revisions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    article_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("articles.id", ondelete="CASCADE"), nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    note: Mapped[str | None] = mapped_column(String(500))
    article: Mapped["Article"] = relationship("Article", back_populates="revisions")
