"""store_orders — revenue attribution for connected stores

Turns "the article gained 400 clicks" into "the article earned 2,300", which is
the join every other analytics number was missing.

Deliberately narrow: total, currency, date, Shopify's own attribution fields,
and the article we resolve them to. No line items, no customer, no address --
storing a merchant's customer data to answer "which article earned this" would
collect personal information the feature never reads.

Revision ID: z3storeorder8
Revises: y2crontoggle7
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "z3storeorder8"
down_revision = "y2crontoggle7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "store_orders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("org_id", UUID(as_uuid=True),
                  sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", UUID(as_uuid=True),
                  sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(30), nullable=True),
        sa.Column("external_id", sa.String(64), nullable=False),
        # NUMERIC, never float: a rounding drift in revenue is a number the
        # customer reconciles against their own dashboard and loses trust over.
        sa.Column("total_price", sa.Numeric(14, 2), nullable=True),
        sa.Column("currency", sa.String(10), nullable=True),
        sa.Column("ordered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("landing_site", sa.String(2000), nullable=True),
        sa.Column("referring_site", sa.String(2000), nullable=True),
        sa.Column("source_name", sa.String(60), nullable=True),
        sa.Column("attributed_article_id", UUID(as_uuid=True),
                  sa.ForeignKey("articles.id", ondelete="SET NULL"), nullable=True),
        sa.Column("attributed_path", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "external_id", name="uq_store_order_external"),
    )
    op.create_index("ix_store_order_project_date", "store_orders", ["project_id", "ordered_at"])


def downgrade() -> None:
    op.drop_index("ix_store_order_project_date", table_name="store_orders")
    op.drop_table("store_orders")
