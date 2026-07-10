import uuid

from sqlalchemy import JSON, Boolean, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class WatchedCompetitor(Base, TimestampMixin):
    """A competitor URL Sable re-scans weekly for the project."""
    __tablename__ = "watched_competitors"
    __table_args__ = (UniqueConstraint("project_id", "url", name="uq_watched_competitor_url"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    label: Mapped[str | None] = mapped_column(String(200))
    last_scorecard: Mapped[dict | None] = mapped_column(JSON)
    last_scanned_at: Mapped[str | None] = mapped_column(String(50))


class MonitorSnapshot(Base, TimestampMixin):
    """Last-seen state per (project, kind) for snapshot-diff detection."""
    __tablename__ = "monitor_snapshots"
    __table_args__ = (UniqueConstraint("project_id", "kind", name="uq_monitor_snapshot_kind"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)  # rankings | market
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    taken_at: Mapped[str] = mapped_column(String(50), nullable=False)


class Alert(Base, TimestampMixin):
    """A monitoring finding surfaced in the alerts inbox."""
    __tablename__ = "alerts"
    __table_args__ = (
        UniqueConstraint("project_id", "dedupe_key", name="uq_alert_dedupe"),
        Index("ix_alerts_project_read", "project_id", "is_read"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    severity: Mapped[str] = mapped_column(String(10), default="info", nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    url: Mapped[str] = mapped_column(String(500), nullable=False)  # app-relative deep link
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    dedupe_key: Mapped[str] = mapped_column(String(200), nullable=False)
