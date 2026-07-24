"""What a project actually is, for Brand DNA and competitor judgement."""

from alembic import op

revision = "z5o6p7q8r9s0"
down_revision = "y4n5o6p7q8r9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE projects DROP COLUMN IF EXISTS description")
