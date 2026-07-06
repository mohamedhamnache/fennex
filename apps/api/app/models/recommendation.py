import uuid

from sqlalchemy import JSON, ForeignKey, Float, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class Recommendation(Base, TimestampMixin):
    __tablename__ = "recommendations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(20), nullable=False)          # opportunity | agent
    source_agent: Mapped[str | None] = mapped_column(String(20))            # zerda | oasis
    kind: Mapped[str | None] = mapped_column(String(30))                    # striking_distance | ctr_win
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)
    anchor_query: Mapped[str | None] = mapped_column(String(500))           # null = non-measurable
    anchor_url: Mapped[str | None] = mapped_column(String(2048))
    status: Mapped[str] = mapped_column(String(20), default="tracking", nullable=False)
    outcome: Mapped[str | None] = mapped_column(String(20))                 # pending | won | flat | declined
    impact_score: Mapped[float | None] = mapped_column(Float)
    baseline: Mapped[dict | None] = mapped_column(JSON)                     # {clicks,impressions,ctr,position,captured_at}
    latest: Mapped[dict | None] = mapped_column(JSON)                       # {clicks,impressions,ctr,position}
    detected_content: Mapped[list | None] = mapped_column(JSON)            # [{type,id,title,matched_on}]
    done_at: Mapped[str | None] = mapped_column(String(50))                # ISO date
    measured_at: Mapped[str | None] = mapped_column(String(50))            # ISO date
