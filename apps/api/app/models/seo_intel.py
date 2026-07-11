import uuid
from datetime import date

from sqlalchemy import JSON, Boolean, Date, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class TrackedKeyword(Base, TimestampMixin):
    """A keyword whose real Google SERP position Zerda tracks daily."""
    __tablename__ = "tracked_keywords"
    __table_args__ = (UniqueConstraint("project_id", "keyword", name="uq_tracked_keyword"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    keyword: Mapped[str] = mapped_column(String(500), nullable=False)
    language: Mapped[str] = mapped_column(String(10), default="en", nullable=False)
    location_code: Mapped[int] = mapped_column(Integer, default=2840, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class SerpSnapshot(Base, TimestampMixin):
    """One day's SERP result for a tracked keyword."""
    __tablename__ = "serp_snapshots"
    __table_args__ = (UniqueConstraint("tracked_keyword_id", "date", name="uq_serp_snapshot_day"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    tracked_keyword_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tracked_keywords.id", ondelete="CASCADE"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    position: Mapped[float | None] = mapped_column(Float)
    url: Mapped[str | None] = mapped_column(String(2048))
    top10: Mapped[list | None] = mapped_column(JSON)
    features: Mapped[list | None] = mapped_column(JSON)
