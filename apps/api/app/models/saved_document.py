import uuid

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class SavedDocument(Base, TimestampMixin):
    """A deliverable kept out of the chat.

    Reports and plans live in the conversation that produced them, which is
    fine until the thread scrolls away or is deleted. Saving one copies it
    here so it survives the conversation and can be found without remembering
    which chat made it.
    """

    __tablename__ = "saved_documents"
    __table_args__ = (
        Index("ix_saved_documents_project", "org_id", "project_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    # The thread it came from, kept for provenance. Deleting the conversation
    # must not take the saved copy with it, so this is nulled rather than cascaded.
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True)

    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    fmt: Mapped[str] = mapped_column(String(20), default="markdown", nullable=False)
    employee_id: Mapped[str | None] = mapped_column(String(40))
    kind: Mapped[str] = mapped_column(String(30), default="report", nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
