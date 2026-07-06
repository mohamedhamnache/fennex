import uuid
from datetime import datetime
from sqlalchemy import Float, ForeignKey, Text, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class ImageScore(Base):
    __tablename__ = "image_scores"
    __table_args__ = (UniqueConstraint("image_id", name="uq_image_score_image"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    image_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("generated_images.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    visual_quality: Mapped[float | None] = mapped_column(Float, nullable=True)
    brand_consistency: Mapped[float | None] = mapped_column(Float, nullable=True)
    seo_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    ad_performance: Mapped[float | None] = mapped_column(Float, nullable=True)
    overall: Mapped[float | None] = mapped_column(Float, nullable=True)
    feedback: Mapped[str | None] = mapped_column(Text, nullable=True)
    scored_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
