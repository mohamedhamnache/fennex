"""serp intelligence tables: tracked_keywords, serp_snapshots

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-07-11
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tracked_keywords",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("keyword", sa.String(500), nullable=False),
        sa.Column("language", sa.String(10), nullable=False, server_default="en"),
        sa.Column("location_code", sa.Integer(), nullable=False, server_default="2840"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "keyword", name="uq_tracked_keyword"),
    )
    op.create_index("ix_tracked_keywords_project_id", "tracked_keywords", ["project_id"])
    op.create_table(
        "serp_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tracked_keyword_id", UUID(as_uuid=True), sa.ForeignKey("tracked_keywords.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("position", sa.Float()),
        sa.Column("url", sa.String(2048)),
        sa.Column("top10", sa.JSON()),
        sa.Column("features", sa.JSON()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tracked_keyword_id", "date", name="uq_serp_snapshot_day"),
    )
    op.create_index("ix_serp_snapshots_project_id", "serp_snapshots", ["project_id"])
    op.create_index("ix_serp_snapshots_tracked_keyword_id", "serp_snapshots", ["tracked_keyword_id"])


def downgrade() -> None:
    op.drop_table("serp_snapshots")
    op.drop_table("tracked_keywords")
