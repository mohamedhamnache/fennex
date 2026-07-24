import uuid

from sqlalchemy import Boolean, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import TimestampMixin


class Connector(Base, TimestampMixin):
    """An MCP server an organisation has connected.

    Connectors were deployment-level environment variables, which meant nobody
    could add one without a redeploy. They are now per organisation, stored
    here, with the credential encrypted the same way LLM keys are.

    An employee still only reaches a connector it declared in `connected_apps`
    and whose permission the run holds -- connecting one grants availability,
    not access.
    """

    __tablename__ = "connectors"
    __table_args__ = (
        Index("ix_connectors_org_app", "org_id", "app", unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)

    app: Mapped[str] = mapped_column(String(40), nullable=False)
    url: Mapped[str | None] = mapped_column(Text)
    # Sent as `Authorization: Bearer <token>`; never returned to the client.
    encrypted_token: Mapped[str | None] = mapped_column(Text)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    last_status: Mapped[str | None] = mapped_column(String(20))   # ok | error
    last_error: Mapped[str | None] = mapped_column(Text)
    last_checked_at: Mapped[str | None] = mapped_column(String(50))
    tool_count: Mapped[str | None] = mapped_column(String(10))
