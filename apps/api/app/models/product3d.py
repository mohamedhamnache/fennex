import uuid
from enum import Enum as PyEnum

from sqlalchemy import ForeignKey, Text, Enum as SAEnum, JSON, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class Product3DStatus(str, PyEnum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"


class ModelFormat(str, PyEnum):
    """Output formats Product-to-3D can produce.

    Deliberately GLB and OBJ only for this iteration -- see design spec
    section 3 "Format conversion". FBX/USDZ are out of scope; adding them
    later is a matter of extending this enum and `convert()`, not touching
    the job model, callers, or the UI wiring.
    """

    glb = "glb"
    obj = "obj"


class Product3DJob(Base, TimestampMixin):
    __tablename__ = "product3d_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    source_image_url: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[Product3DStatus] = mapped_column(
        SAEnum(Product3DStatus, name="product3d_status_enum", values_callable=lambda x: [e.value for e in x]),
        default=Product3DStatus.pending,
        nullable=False,
    )
    # "draft" | "high" | "ultra" -- app.services.prompting.vocab.QualityToken.
    quality: Mapped[str] = mapped_column(String(20), nullable=False, default="high")
    # "2K" | "4K" | "8K" -- app.services.prompting.vocab.TextureResolutionToken.
    texture_resolution: Mapped[str] = mapped_column(String(10), nullable=False, default="2K")
    # List of ModelFormat values requested at enqueue time, e.g. ["glb", "obj"].
    requested_formats: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Per-format output URL, populated as each conversion succeeds, e.g.
    # {"glb": "https://...", "obj": "https://..."}. A format present in
    # requested_formats but absent here failed independently -- the whole job
    # is not failed just because one conversion did (see design spec: "the
    # job records the failure for that format and still returns the formats
    # that succeeded").
    output_urls: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
