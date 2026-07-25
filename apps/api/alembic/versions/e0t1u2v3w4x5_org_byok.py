"""organizations.byok_enabled

Revision ID: e0t1u2v3w4x5
Revises: d9s0t1u2v3w4
"""
from alembic import op

revision = "e0t1u2v3w4x5"
down_revision = "d9s0t1u2v3w4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS byok_enabled BOOLEAN NOT NULL DEFAULT false")


def downgrade() -> None:
    op.execute("ALTER TABLE organizations DROP COLUMN IF EXISTS byok_enabled")
