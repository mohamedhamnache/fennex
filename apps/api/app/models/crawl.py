import uuid
from enum import Enum as PyEnum

from sqlalchemy import String, ForeignKey, Integer, JSON, Text, Enum as SAEnum, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin


class CrawlStatus(str, PyEnum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class CrawlJob(Base, TimestampMixin):
    __tablename__ = "crawl_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[CrawlStatus] = mapped_column(SAEnum(CrawlStatus, name="crawl_status_enum"), default=CrawlStatus.pending)
    pages_crawled: Mapped[int] = mapped_column(Integer, default=0)
    pages_total: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)

    pages: Mapped[list["CrawledPage"]] = relationship(
        "CrawledPage", back_populates="crawl_job", cascade="all, delete-orphan"
    )


class CrawledPage(Base, TimestampMixin):
    __tablename__ = "crawled_pages"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    crawl_job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("crawl_jobs.id", ondelete="CASCADE"), nullable=False
    )
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    status_code: Mapped[int | None] = mapped_column(Integer)
    signals: Mapped[dict | None] = mapped_column(JSON)
    seo_score: Mapped[float | None] = mapped_column(Float)

    crawl_job: Mapped["CrawlJob"] = relationship("CrawlJob", back_populates="pages")


class AuditStatus(str, PyEnum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class SEOAudit(Base, TimestampMixin):
    __tablename__ = "seo_audits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    crawl_job_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("crawl_jobs.id"), nullable=True
    )
    status: Mapped[AuditStatus] = mapped_column(SAEnum(AuditStatus, name="audit_status_enum"), default=AuditStatus.pending)
    overall_score: Mapped[float | None] = mapped_column(Float)
    technical_score: Mapped[float | None] = mapped_column(Float)
    content_score: Mapped[float | None] = mapped_column(Float)
    onpage_score: Mapped[float | None] = mapped_column(Float)
    issues: Mapped[list | None] = mapped_column(JSON)
    summary: Mapped[dict | None] = mapped_column(JSON)
