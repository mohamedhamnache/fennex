"""admin_audit_log table

Revision ID: p1a2b3c4d5e6
Revises: n0j1k2l3m4n5
Create Date: 2026-07-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "p1a2b3c4d5e6"
down_revision = "n0j1k2l3m4n5"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "admin_audit_log",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("actor_admin_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("resource_type", sa.String(60), nullable=False),
        sa.Column("resource_id", sa.String(80), nullable=True),
        sa.Column("before_json", sa.JSON, nullable=True),
        sa.Column("after_json", sa.JSON, nullable=True),
        sa.Column("ip", sa.String(64), nullable=True),
        sa.Column("result", sa.String(20), nullable=False, server_default="ok"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_admin_audit_log_actor_admin_id", "admin_audit_log", ["actor_admin_id"])
    op.create_index("ix_admin_audit_log_resource_id", "admin_audit_log", ["resource_id"])
    op.create_index("ix_admin_audit_log_created_at", "admin_audit_log", ["created_at"])


def downgrade():
    op.drop_index("ix_admin_audit_log_created_at", table_name="admin_audit_log")
    op.drop_index("ix_admin_audit_log_resource_id", table_name="admin_audit_log")
    op.drop_index("ix_admin_audit_log_actor_admin_id", table_name="admin_audit_log")
    op.drop_table("admin_audit_log")
