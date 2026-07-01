"""add new image style enum values

Revision ID: m1a2b3c4d5e6
Revises: l7g8b9c0d1e2
Create Date: 2026-07-01
"""
from alembic import op

revision = "m1a2b3c4d5e6"
down_revision = "l7g8b9c0d1e2"
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE image_style_enum ADD VALUE IF NOT EXISTS '3d_render'")
        op.execute("ALTER TYPE image_style_enum ADD VALUE IF NOT EXISTS 'anime'")
        op.execute("ALTER TYPE image_style_enum ADD VALUE IF NOT EXISTS 'cinematic'")
        op.execute("ALTER TYPE image_style_enum ADD VALUE IF NOT EXISTS 'luxury_product'")


def downgrade():
    pass  # PostgreSQL does not support removing enum values
