import uuid

from sqlalchemy import JSON, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class EmployeeMemory(Base, TimestampMixin):
    """Institutional knowledge -- what the AI company has learned.

    Written by `Employee.learn()` and by the Orchestrator, read back into every
    subsequent run so employees compound their knowledge instead of restarting
    cold. `embedding` is populated when a vector backend is configured; the
    default backend ranks on recency + keyword overlap and ignores it.
    """

    __tablename__ = "employee_memories"
    __table_args__ = (
        Index("ix_employee_memories_scope", "org_id", "project_id", "scope"),
        Index("ix_employee_memories_lookup", "org_id", "employee_id", "kind"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=True)

    employee_id: Mapped[str] = mapped_column(String(40), nullable=False)
    department: Mapped[str | None] = mapped_column(String(40))
    scope: Mapped[str] = mapped_column(String(20), default="project", nullable=False)
    kind: Mapped[str] = mapped_column(String(30), default="note", nullable=False)

    key: Mapped[str | None] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[dict | None] = mapped_column(JSON)

    # Reinforcement: memories that keep proving useful outrank stale ones.
    weight: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
    hits: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    embedding: Mapped[list | None] = mapped_column(JSON)
