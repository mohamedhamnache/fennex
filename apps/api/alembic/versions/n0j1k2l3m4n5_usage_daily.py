"""usage_daily rollup table

Revision ID: n0j1k2l3m4n5
Revises: m9i0j1k2l3m4
Create Date: 2026-07-27

"""
from alembic import op
import sqlalchemy as sa

revision = "n0j1k2l3m4n5"
down_revision = "m9i0j1k2l3m4"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "usage_daily",
        sa.Column("day", sa.Date, primary_key=True),
        sa.Column("org_id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("provider", sa.String(50), primary_key=True),
        sa.Column("model", sa.String(80), primary_key=True, server_default=""),
        sa.Column("unit", sa.String(30), primary_key=True),
        sa.Column("requests", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("input_tokens", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("cache_read_tokens", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("seo_count", sa.BigInteger, nullable=False, server_default="0"),
        sa.Column("cost_micros", sa.BigInteger, nullable=False, server_default="0"),
    )
    op.create_index("ix_usage_daily_org_day", "usage_daily", ["org_id", "day"])
    op.create_index("ix_usage_daily_day", "usage_daily", ["day"])


def downgrade():
    op.drop_index("ix_usage_daily_day", table_name="usage_daily")
    op.drop_index("ix_usage_daily_org_day", table_name="usage_daily")
    op.drop_table("usage_daily")
