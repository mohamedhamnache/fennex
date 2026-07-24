"""Per-organisation MCP connectors.

Idempotent: main.py runs Base.metadata.create_all at startup.
"""

from alembic import op

revision = "x3m4n5o6p7q8"
down_revision = "w2l3m4n5o6p7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS connectors (
            id UUID PRIMARY KEY,
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            app VARCHAR(40) NOT NULL,
            url TEXT,
            encrypted_token TEXT,
            enabled BOOLEAN NOT NULL DEFAULT true,
            last_status VARCHAR(20),
            last_error TEXT,
            last_checked_at VARCHAR(50),
            tool_count VARCHAR(10),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_connectors_org_app "
               "ON connectors (org_id, app)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_connectors_org_app")
    op.execute("DROP TABLE IF EXISTS connectors")
