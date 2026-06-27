"""Phase 12c: org_invites table

Revision ID: i4d5e6f7a8b9
Revises: h3c4d5e6f7a8
Create Date: 2026-06-27
"""
from alembic import op
import sqlalchemy as sa

revision = "i4d5e6f7a8b9"
down_revision = "h3c4d5e6f7a8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS org_invites (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL,
            token VARCHAR(500) NOT NULL UNIQUE,
            accepted BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        );
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_org_invites_org_id ON org_invites (org_id);"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_org_invites_email ON org_invites (email);"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS org_invites CASCADE;"))
