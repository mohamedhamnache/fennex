"""brand kit/voice become per-project

Revision ID: c8r9s0t1u2v3
Revises: b7q8r9s0t1u2
"""
from alembic import op

revision = "c8r9s0t1u2v3"
down_revision = "b7q8r9s0t1u2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE")
    op.execute("ALTER TABLE brand_voices ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE")
    op.execute("ALTER TABLE brand_kits DROP CONSTRAINT IF EXISTS uq_brand_kit_org")
    # Backfill existing rows to the org's first project (oldest).
    op.execute("""
        UPDATE brand_kits bk SET project_id = (
            SELECT p.id FROM projects p WHERE p.org_id = bk.org_id
            ORDER BY p.created_at ASC LIMIT 1
        ) WHERE bk.project_id IS NULL
    """)
    op.execute("""
        UPDATE brand_voices bv SET project_id = (
            SELECT p.id FROM projects p WHERE p.org_id = bv.org_id
            ORDER BY p.created_at ASC LIMIT 1
        ) WHERE bv.project_id IS NULL
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_brand_kits_project ON brand_kits (project_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_brand_voices_project ON brand_voices (project_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_brand_voices_project")
    op.execute("DROP INDEX IF EXISTS ix_brand_kits_project")
    op.execute("ALTER TABLE brand_voices DROP COLUMN IF EXISTS project_id")
    op.execute("ALTER TABLE brand_kits DROP COLUMN IF EXISTS project_id")
