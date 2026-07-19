"""shopify_connections: client-credentials columns (2026 Dev Dashboard model)

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-07-19
"""
from alembic import op

revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent: dev create_all may already have added these from the model.
    op.execute("ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS client_id VARCHAR(255)")
    op.execute("ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS client_secret_encrypted TEXT")
    op.execute("ALTER TABLE shopify_connections ADD COLUMN IF NOT EXISTS token_expires_at VARCHAR(50)")
    # A client-credentials connection has no pasted token until the first exchange.
    op.execute("ALTER TABLE shopify_connections ALTER COLUMN access_token_encrypted DROP NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE shopify_connections DROP COLUMN IF EXISTS client_id")
    op.execute("ALTER TABLE shopify_connections DROP COLUMN IF EXISTS client_secret_encrypted")
    op.execute("ALTER TABLE shopify_connections DROP COLUMN IF EXISTS token_expires_at")
