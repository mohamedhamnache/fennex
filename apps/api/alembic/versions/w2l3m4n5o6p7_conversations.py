"""Main Chat: conversations, messages and pending approvals.

Idempotent: `main.py` runs `Base.metadata.create_all` at startup, so these
tables may already exist on environments that booted the app before migrating.
"""

from alembic import op

revision = "w2l3m4n5o6p7"
down_revision = "v1k2l3m4n5o6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id UUID PRIMARY KEY,
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
            user_id UUID REFERENCES users(id) ON DELETE SET NULL,
            title VARCHAR(200),
            owner_employee_id VARCHAR(40),
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            participants JSON,
            meta JSON,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_conversations_project "
               "ON conversations (org_id, project_id, created_at)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS conversation_messages (
            id UUID PRIMARY KEY,
            conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            seq INTEGER NOT NULL DEFAULT 0,
            role VARCHAR(20) NOT NULL,
            employee_id VARCHAR(40),
            event VARCHAR(30),
            content TEXT NOT NULL DEFAULT '',
            routing JSON,
            confidence DOUBLE PRECISION,
            artifact_type VARCHAR(30),
            artifact_ids JSON,
            structured JSON,
            error TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_conversation_messages_thread "
               "ON conversation_messages (conversation_id, seq)")

    op.execute("""
        CREATE TABLE IF NOT EXISTS pending_approvals (
            id UUID PRIMARY KEY,
            org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
            employee_id VARCHAR(40) NOT NULL,
            action_id VARCHAR(60) NOT NULL,
            tool VARCHAR(60),
            summary TEXT NOT NULL DEFAULT '',
            preview JSON,
            payload JSON,
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            decided_by UUID REFERENCES users(id) ON DELETE SET NULL,
            decided_at VARCHAR(50),
            destructive BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_pending_approvals_conversation "
               "ON pending_approvals (conversation_id, status)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS pending_approvals")
    op.execute("DROP TABLE IF EXISTS conversation_messages")
    op.execute("DROP TABLE IF EXISTS conversations")
