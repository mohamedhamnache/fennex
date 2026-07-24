import uuid

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from pgvector.sqlalchemy import Vector

from app.models.base import TimestampMixin


class ProjectDocument(Base, TimestampMixin):
    """Something the user gave the agency to read.

    A brand book, a product sheet, past campaign notes -- whatever the team
    should know without being told again. The text is kept whole here; the
    chunks below are what retrieval actually searches.
    """

    __tablename__ = "project_documents"
    __table_args__ = (
        Index("ix_project_documents_project", "org_id", "project_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)

    title: Mapped[str] = mapped_column(String(300), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), default="note", nullable=False)
    source: Mapped[str | None] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text, nullable=False)
    word_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    chunk_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ready", nullable=False)
    error: Mapped[str | None] = mapped_column(Text)


class ProjectChunk(Base, TimestampMixin):
    """One retrievable passage.

    Embedded once at ingest and never again -- re-embedding on every query is
    the easiest way to make a knowledge base cost more than it saves.
    """

    __tablename__ = "project_chunks"
    __table_args__ = (
        Index("ix_project_chunks_project", "project_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("project_documents.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)

    seq: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # text-embedding-3-small. Small and cheap on purpose: retrieval quality at
    # project scale does not need a larger model, and this is billed per ingest.
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536))
