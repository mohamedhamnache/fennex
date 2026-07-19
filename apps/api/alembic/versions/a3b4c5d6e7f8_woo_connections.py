"""woo_connections table

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-07-19
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "a3b4c5d6e7f8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Idempotent create: dev create_all may already have made this from the model.
    op.execute("""
        CREATE TABLE IF NOT EXISTS woo_connections (
            id UUID PRIMARY KEY,
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            store_url VARCHAR(500) NOT NULL,
            consumer_key VARCHAR(255) NOT NULL,
            consumer_secret_encrypted TEXT NOT NULL,
            shop_name VARCHAR(255),
            is_active BOOLEAN DEFAULT true NOT NULL,
            last_tested_at VARCHAR(50),
            last_test_ok BOOLEAN,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_woo_connection_project UNIQUE (project_id)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_woo_connections_project_id ON woo_connections (project_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS woo_connections CASCADE")
