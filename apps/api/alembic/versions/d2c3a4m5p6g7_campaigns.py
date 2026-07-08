"""campaigns + campaign_steps"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "d2c3a4m5p6g7"
down_revision = "c1a2l3e4n5d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "campaigns",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("persona", sa.String(20), nullable=False, server_default="creator"),
        sa.Column("status", sa.String(20), nullable=False, server_default="planned"),
        sa.Column("director_summary", sa.Text()),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "campaign_steps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("campaign_id", UUID(as_uuid=True), sa.ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column("agent", sa.String(20), nullable=False),
        sa.Column("action", sa.String(40), nullable=False),
        sa.Column("brief", sa.JSON()),
        sa.Column("why", sa.Text()),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("summary", sa.Text()),
        sa.Column("artifact_type", sa.String(20)),
        sa.Column("artifact_ids", sa.JSON()),
        sa.Column("structured", sa.JSON()),
        sa.Column("error", sa.Text()),
        sa.Column("started_at", sa.String(50)),
        sa.Column("finished_at", sa.String(50)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_campaign_steps_campaign_order", "campaign_steps", ["campaign_id", "order"])


def downgrade() -> None:
    op.drop_index("ix_campaign_steps_campaign_order", table_name="campaign_steps")
    op.drop_table("campaign_steps")
    op.drop_table("campaigns")
