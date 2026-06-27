"""Phase 12b: social_connections table

Revision ID: h3c4d5e6f7a8
Revises: g2b3c4d5e6f7
Create Date: 2026-06-27
"""
from alembic import op
import sqlalchemy as sa

revision = "h3c4d5e6f7a8"
down_revision = "g2b3c4d5e6f7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS social_connections (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            platform social_platform_enum NOT NULL,
            handle VARCHAR(200),
            encrypted_token TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now(),
            CONSTRAINT uq_social_connection_org_platform UNIQUE (org_id, platform)
        );
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_social_connections_org_id ON social_connections (org_id);"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS social_connections CASCADE;"))
