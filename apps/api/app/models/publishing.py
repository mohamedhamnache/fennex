import uuid
from enum import Enum as PyEnum
from sqlalchemy import String, ForeignKey, Text, Enum as SAEnum, Boolean, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base
from app.models.base import TimestampMixin


class PublishingPlatform(str, PyEnum):
    wordpress = "wordpress"
    ghost = "ghost"
    notion = "notion"
    custom = "custom"


class PublishJobStatus(str, PyEnum):
    pending = "pending"
    running = "running"
    done = "done"
    failed = "failed"


class PublishingConnection(Base, TimestampMixin):
    __tablename__ = "publishing_connections"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    platform: Mapped[PublishingPlatform] = mapped_column(SAEnum(PublishingPlatform, name="publishing_platform_enum"), nullable=False)
    site_url: Mapped[str] = mapped_column(String(500), nullable=False)
    credentials_encrypted: Mapped[str | None] = mapped_column(Text)   # JSON encrypted with AES-256
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_tested_at: Mapped[str | None] = mapped_column(String(50))
    last_test_ok: Mapped[bool | None] = mapped_column(Boolean)
    publish_jobs: Mapped[list["PublishJob"]] = relationship("PublishJob", back_populates="connection", cascade="all, delete-orphan")


class PublishJob(Base, TimestampMixin):
    __tablename__ = "publish_jobs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    connection_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("publishing_connections.id", ondelete="CASCADE"), nullable=False)
    article_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("articles.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[PublishJobStatus] = mapped_column(SAEnum(PublishJobStatus, name="publish_job_status_enum"), default=PublishJobStatus.pending)
    platform_post_id: Mapped[str | None] = mapped_column(String(200))   # WordPress post ID, etc.
    published_url: Mapped[str | None] = mapped_column(String(500))       # live URL after publish
    error: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict | None] = mapped_column(JSON)                       # platform-specific response
    connection: Mapped["PublishingConnection"] = relationship("PublishingConnection", back_populates="publish_jobs")
