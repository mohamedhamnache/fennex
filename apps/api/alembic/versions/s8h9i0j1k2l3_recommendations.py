"""recommendations table"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "s8h9i0j1k2l3"
down_revision = "r7g8h9i0j1k2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "recommendations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("source_agent", sa.String(20)),
        sa.Column("kind", sa.String(30)),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("detail", sa.Text()),
        sa.Column("anchor_query", sa.String(500)),
        sa.Column("anchor_url", sa.String(2048)),
        sa.Column("status", sa.String(20), nullable=False, server_default="tracking"),
        sa.Column("outcome", sa.String(20)),
        sa.Column("impact_score", sa.Float()),
        sa.Column("baseline", sa.JSON()),
        sa.Column("latest", sa.JSON()),
        sa.Column("detected_content", sa.JSON()),
        sa.Column("done_at", sa.String(50)),
        sa.Column("measured_at", sa.String(50)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_recommendations_project_id", "recommendations", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_recommendations_project_id", table_name="recommendations")
    op.drop_table("recommendations")
