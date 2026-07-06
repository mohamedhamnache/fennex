"""add product_shot to image_usage_enum

Revision ID: n2b3c4d5e6f7
Revises: m1a2b3c4d5e6
Create Date: 2026-07-02

"""
from alembic import op

revision = "n2b3c4d5e6f7"
down_revision = "m1a2b3c4d5e6"
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE image_usage_enum ADD VALUE IF NOT EXISTS 'product_shot'")


def downgrade():
    pass
