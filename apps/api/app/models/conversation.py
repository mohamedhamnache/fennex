import uuid

from sqlalchemy import JSON, Boolean, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class Conversation(Base, TimestampMixin):
    """One Main Chat thread.

    `owner_employee_id` is the employee currently holding the conversation. The
    Router sets it on handover and keeps it sticky, so follow-up messages stay
    with whoever is already doing the work.
    """

    __tablename__ = "conversations"
    __table_args__ = (
        Index("ix_conversations_project", "org_id", "project_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    title: Mapped[str | None] = mapped_column(String(200))
    owner_employee_id: Mapped[str | None] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    # Employees who have participated, in join order -- drives the UI roster.
    participants: Mapped[list | None] = mapped_column(JSON)
    meta: Mapped[dict | None] = mapped_column(JSON)


class ConversationMessage(Base, TimestampMixin):
    """A turn in the thread.

    `role` is one of:
        user       what the person typed
        employee   a specialist's reply
        system     router notices: joins, handoffs, stage markers
        approval   a pending destructive action awaiting a decision
    """

    __tablename__ = "conversation_messages"
    __table_args__ = (
        Index("ix_conversation_messages_thread", "conversation_id", "seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    seq: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    role: Mapped[str] = mapped_column(String(20), nullable=False)
    employee_id: Mapped[str | None] = mapped_column(String(40))
    event: Mapped[str | None] = mapped_column(String(30))   # joined | handoff | stage | ...
    content: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # Routing transparency: what the Router decided and how sure it was.
    routing: Mapped[dict | None] = mapped_column(JSON)
    confidence: Mapped[float | None] = mapped_column(Float)

    artifact_type: Mapped[str | None] = mapped_column(String(30))
    artifact_ids: Mapped[list | None] = mapped_column(JSON)
    structured: Mapped[dict | None] = mapped_column(JSON)
    error: Mapped[str | None] = mapped_column(Text)


class PendingApproval(Base, TimestampMixin):
    """A destructive action held for human sign-off.

    Publishing, sending, scheduling and paying never run straight from a chat
    message -- they land here with a preview and wait for approve/reject/edit.
    """

    __tablename__ = "pending_approvals"
    __table_args__ = (
        Index("ix_pending_approvals_conversation", "conversation_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=True)

    employee_id: Mapped[str] = mapped_column(String(40), nullable=False)
    action_id: Mapped[str] = mapped_column(String(60), nullable=False)
    tool: Mapped[str | None] = mapped_column(String(60))
    summary: Mapped[str] = mapped_column(Text, default="", nullable=False)
    preview: Mapped[dict | None] = mapped_column(JSON)
    payload: Mapped[dict | None] = mapped_column(JSON)

    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    decided_at: Mapped[str | None] = mapped_column(String(50))
    destructive: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
