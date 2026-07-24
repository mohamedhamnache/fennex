"""Project knowledge: documents the agency reads, and their embedded chunks."""

from alembic import op

revision = "a6p7q8r9s0t1"
down_revision = "z5o6p7q8r9s0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("""
        CREATE TABLE IF NOT EXISTS project_documents (
            id UUID PRIMARY KEY,
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            title VARCHAR(300) NOT NULL,
            kind VARCHAR(30) NOT NULL DEFAULT 'note',
            source VARCHAR(500),
            body TEXT NOT NULL,
            word_count INTEGER NOT NULL DEFAULT 0,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            status VARCHAR(20) NOT NULL DEFAULT 'ready',
            error TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_project_documents_project "
               "ON project_documents (org_id, project_id, created_at)")
    op.execute("""
        CREATE TABLE IF NOT EXISTS project_chunks (
            id UUID PRIMARY KEY,
            document_id UUID NOT NULL REFERENCES project_documents(id) ON DELETE CASCADE,
            project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            seq INTEGER NOT NULL DEFAULT 0,
            text TEXT NOT NULL,
            embedding vector(1536),
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_project_chunks_project "
               "ON project_chunks (project_id)")
    # Approximate nearest-neighbour: exact search is fine at this scale, but
    # the index costs nothing and keeps it fast as a library grows.
    op.execute("CREATE INDEX IF NOT EXISTS ix_project_chunks_vector "
               "ON project_chunks USING ivfflat (embedding vector_cosine_ops) "
               "WITH (lists = 50)")
    # A cached digest, so 'the agency knows the project' costs nothing per turn.
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS knowledge_digest TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS knowledge_digest")
    op.execute("DROP TABLE IF EXISTS project_chunks")
    op.execute("DROP TABLE IF EXISTS project_documents")
