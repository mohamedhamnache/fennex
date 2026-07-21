from alembic import op

revision = "u0j1k2l3m4n5"
down_revision = "t9i0j1k2l3m4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE articles ADD COLUMN IF NOT EXISTS geo_score DOUBLE PRECISION")


def downgrade() -> None:
    op.execute("ALTER TABLE articles DROP COLUMN IF EXISTS geo_score")
