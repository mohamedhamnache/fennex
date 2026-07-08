import uuid

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class CalendarEntry(Base, TimestampMixin):
    __tablename__ = "calendar_entries"
    __table_args__ = (
        Index("ix_calendar_entries_project_id", "project_id"),
        Index("ix_calendar_entries_state_scheduled_at", "state", "scheduled_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    content_type: Mapped[str] = mapped_column(String(20), nullable=False)   # article | social | banner
    content_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    scheduled_at: Mapped[str] = mapped_column(String(50), nullable=False)   # ISO-8601 UTC
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", nullable=False)
    target_kind: Mapped[str | None] = mapped_column(String(20))             # wordpress | linkedin
    connection_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    state: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    published_at: Mapped[str | None] = mapped_column(String(50))
    published_url: Mapped[str | None] = mapped_column(String(500))
