"""discovery_runs table

Revision ID: b7q8r9s0t1u2
Revises: a6p7q8r9s0t1
"""
from alembic import op

revision = "b7q8r9s0t1u2"
down_revision = "a6p7q8r9s0t1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS discovery_runs (
            id UUID PRIMARY KEY,
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
            input_url VARCHAR(500),
            input_description TEXT,
            status VARCHAR(20) NOT NULL DEFAULT 'queued',
            stage VARCHAR(60),
            progress INTEGER NOT NULL DEFAULT 0,
            result JSONB NOT NULL DEFAULT '{}'::jsonb,
            error TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_discovery_runs_org ON discovery_runs (org_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS discovery_runs")
