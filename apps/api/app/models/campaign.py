import uuid
from datetime import date

from sqlalchemy import JSON, Boolean, Date, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class Campaign(Base, TimestampMixin):
    __tablename__ = "campaigns"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    persona: Mapped[str] = mapped_column(String(20), default="creator", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="planned", nullable=False)
    director_summary: Mapped[str | None] = mapped_column(Text)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)  # manual | autopilot
    week_of: Mapped[date | None] = mapped_column(Date, nullable=True)  # Monday of the plan's week (autopilot only)


class CampaignStep(Base, TimestampMixin):
    __tablename__ = "campaign_steps"
    __table_args__ = (Index("ix_campaign_steps_campaign_order", "campaign_id", "order"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    campaign_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    agent: Mapped[str] = mapped_column(String(20), nullable=False)
    action: Mapped[str] = mapped_column(String(40), nullable=False)
    brief: Mapped[dict | None] = mapped_column(JSON)
    why: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    summary: Mapped[str | None] = mapped_column(Text)
    artifact_type: Mapped[str | None] = mapped_column(String(20))
    artifact_ids: Mapped[list | None] = mapped_column(JSON)
    structured: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[str | None] = mapped_column(String(50))
    finished_at: Mapped[str | None] = mapped_column(String(50))
