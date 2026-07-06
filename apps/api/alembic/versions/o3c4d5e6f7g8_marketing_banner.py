"""add marketing_banner usage and banner_format column

Revision ID: o3c4d5e6f7g8
Revises: a761c474162a
Create Date: 2026-07-02

"""
import sqlalchemy as sa
from alembic import op

revision = "o3c4d5e6f7g8"
down_revision = "a761c474162a"
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE image_usage_enum ADD VALUE IF NOT EXISTS 'marketing_banner'")
    op.add_column("generated_images", sa.Column("banner_format", sa.String(60), nullable=True))


def downgrade():
    op.drop_column("generated_images", "banner_format")
