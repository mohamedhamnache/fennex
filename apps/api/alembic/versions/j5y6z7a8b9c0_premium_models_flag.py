"""organizations.premium_models_enabled

Revision ID: j5y6z7a8b9c0
Revises: i4x5y6z7a8b9
"""
from alembic import op

revision = "j5y6z7a8b9c0"
down_revision = "i4x5y6z7a8b9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS "
        "premium_models_enabled BOOLEAN NOT NULL DEFAULT false"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE organizations DROP COLUMN IF EXISTS premium_models_enabled")
