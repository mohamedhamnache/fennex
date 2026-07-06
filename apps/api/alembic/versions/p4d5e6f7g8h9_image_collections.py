"""add image collections (campaign sets)

Revision ID: p4d5e6f7g8h9
Revises: c519e982a928
Create Date: 2026-07-02

"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "p4d5e6f7g8h9"
down_revision = "c519e982a928"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "image_collections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_image_collections_project_id", "image_collections", ["project_id"])
    op.add_column(
        "generated_images",
        sa.Column(
            "collection_id",
            UUID(as_uuid=True),
            sa.ForeignKey("image_collections.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade():
    op.drop_column("generated_images", "collection_id")
    op.drop_index("ix_image_collections_project_id", table_name="image_collections")
    op.drop_table("image_collections")
