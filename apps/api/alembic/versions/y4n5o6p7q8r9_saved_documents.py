"""Saved deliverables, kept beyond the conversation that produced them."""

from alembic import op

revision = "y4n5o6p7q8r9"
down_revision = "x3m4n5o6p7q8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS saved_documents (
            id UUID PRIMARY KEY,
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
            title VARCHAR(200) NOT NULL,
            body TEXT NOT NULL,
            fmt VARCHAR(20) NOT NULL DEFAULT 'markdown',
            employee_id VARCHAR(40),
            kind VARCHAR(30) NOT NULL DEFAULT 'report',
            word_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_saved_documents_project "
               "ON saved_documents (org_id, project_id, created_at)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_saved_documents_project")
    op.execute("DROP TABLE IF EXISTS saved_documents")
