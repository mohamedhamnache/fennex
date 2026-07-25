import uuid
from sqlalchemy import String, ForeignKey, Text, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base
from app.models.base import TimestampMixin


class BrandKit(Base, TimestampMixin):
    __tablename__ = "brand_kits"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    logo_url: Mapped[str | None] = mapped_column(Text)
    colors: Mapped[list] = mapped_column(JSON, default=list)
    primary_font: Mapped[str | None] = mapped_column(String(100))
    secondary_font: Mapped[str | None] = mapped_column(String(100))
    style_rules: Mapped[str | None] = mapped_column(Text)
    tone: Mapped[str | None] = mapped_column(String(200))
