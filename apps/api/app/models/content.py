import uuid
from enum import Enum as PyEnum
from sqlalchemy import String, ForeignKey, Integer, Text, Enum as SAEnum, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import TimestampMixin


class ContentItemStatus(str, PyEnum):
    idea = "idea"
    draft = "draft"
    in_review = "in_review"
    approved = "approved"
    published = "published"


class ContentItemType(str, PyEnum):
    article = "article"
    landing_page = "landing_page"
    social_post = "social_post"
    email = "email"


class ContentPlan(Base, TimestampMixin):
    __tablename__ = "content_plans"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="Content Plan")
    items: Mapped[list["ContentItem"]] = relationship("ContentItem", back_populates="plan", cascade="all, delete-orphan")


class ContentItem(Base, TimestampMixin):
    __tablename__ = "content_items"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    plan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("content_plans.id", ondelete="CASCADE"), nullable=False)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[ContentItemType] = mapped_column(SAEnum(ContentItemType, name="content_item_type_enum"), default=ContentItemType.article)
    status: Mapped[ContentItemStatus] = mapped_column(SAEnum(ContentItemStatus, name="content_item_status_enum"), default=ContentItemStatus.idea)
    target_keyword: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    scheduled_date: Mapped[str | None] = mapped_column(String(20))  # ISO date string e.g. "2025-07-01"
    word_count_target: Mapped[int | None] = mapped_column(Integer)
    meta: Mapped[dict | None] = mapped_column(JSON)
    plan: Mapped["ContentPlan"] = relationship("ContentPlan", back_populates="items")
