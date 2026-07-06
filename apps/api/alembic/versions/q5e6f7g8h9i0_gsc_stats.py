"""add gsc query/page stat tables for real Search Analytics data

Revision ID: q5e6f7g8h9i0
Revises: p4d5e6f7g8h9
Create Date: 2026-07-04

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "q5e6f7g8h9i0"
down_revision = "p4d5e6f7g8h9"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "gsc_query_stats",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("query", sa.String(length=500), nullable=False),
        sa.Column("clicks", sa.Integer(), server_default="0"),
        sa.Column("impressions", sa.Integer(), server_default="0"),
        sa.Column("ctr", sa.Float(), server_default="0"),
        sa.Column("position", sa.Float(), server_default="0"),
        sa.Column("top_url", sa.String(length=2048), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_gsc_query_stats_project_id", "gsc_query_stats", ["project_id"])

    op.create_table(
        "gsc_page_stats",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("clicks", sa.Integer(), server_default="0"),
        sa.Column("impressions", sa.Integer(), server_default="0"),
        sa.Column("ctr", sa.Float(), server_default="0"),
        sa.Column("position", sa.Float(), server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_gsc_page_stats_project_id", "gsc_page_stats", ["project_id"])


def downgrade():
    op.drop_index("ix_gsc_page_stats_project_id", table_name="gsc_page_stats")
    op.drop_table("gsc_page_stats")
    op.drop_index("ix_gsc_query_stats_project_id", table_name="gsc_query_stats")
    op.drop_table("gsc_query_stats")
