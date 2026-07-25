"""provider_accounts table

Revision ID: d9s0t1u2v3w4
Revises: c8r9s0t1u2v3
"""
from alembic import op

revision = "d9s0t1u2v3w4"
down_revision = "c8r9s0t1u2v3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS provider_accounts (
            id UUID PRIMARY KEY,
            kind VARCHAR(10) NOT NULL,
            provider VARCHAR(50) NOT NULL,
            label VARCHAR(120) NOT NULL,
            encrypted_credentials TEXT NOT NULL,
            is_active BOOLEAN NOT NULL DEFAULT true,
            priority INTEGER NOT NULL DEFAULT 100,
            monthly_budget_cents INTEGER,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_provider_accounts_kind ON provider_accounts (kind, is_active)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS provider_accounts")
