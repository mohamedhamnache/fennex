"""calendar_entries table"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "c1a2l3e4n5d6"
down_revision = "s8h9i0j1k2l3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calendar_entries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_type", sa.String(20), nullable=False),
        sa.Column("content_id", UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("scheduled_at", sa.String(50), nullable=False),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="UTC"),
        sa.Column("target_kind", sa.String(20)),
        sa.Column("connection_id", UUID(as_uuid=True)),
        sa.Column("state", sa.String(20), nullable=False, server_default="planned"),
        sa.Column("error", sa.Text()),
        sa.Column("published_at", sa.String(50)),
        sa.Column("published_url", sa.String(500)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_calendar_entries_project_id", "calendar_entries", ["project_id"])
    op.create_index("ix_calendar_entries_state_scheduled_at", "calendar_entries", ["state", "scheduled_at"])


def downgrade() -> None:
    op.drop_index("ix_calendar_entries_state_scheduled_at", table_name="calendar_entries")
    op.drop_index("ix_calendar_entries_project_id", table_name="calendar_entries")
    op.drop_table("calendar_entries")
