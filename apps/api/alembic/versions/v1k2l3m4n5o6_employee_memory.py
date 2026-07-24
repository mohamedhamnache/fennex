"""Institutional memory for the AI employee framework.

Idempotent: `main.py` runs `Base.metadata.create_all` at startup, so this table
may already exist on environments that booted the app before migrating.
"""

from alembic import op

revision = "v1k2l3m4n5o6"
down_revision = "u0j1k2l3m4n5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS employee_memories (
            id UUID PRIMARY KEY,
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
            employee_id VARCHAR(40) NOT NULL,
            department VARCHAR(40),
            scope VARCHAR(20) NOT NULL DEFAULT 'project',
            kind VARCHAR(30) NOT NULL DEFAULT 'note',
            key VARCHAR(200),
            content TEXT NOT NULL,
            meta JSON,
            weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
            hits INTEGER NOT NULL DEFAULT 0,
            embedding JSON,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_employee_memories_scope "
               "ON employee_memories (org_id, project_id, scope)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_employee_memories_lookup "
               "ON employee_memories (org_id, employee_id, kind)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_employee_memories_lookup")
    op.execute("DROP INDEX IF EXISTS ix_employee_memories_scope")
    op.execute("DROP TABLE IF EXISTS employee_memories")
