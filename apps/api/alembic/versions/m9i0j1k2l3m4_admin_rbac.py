from alembic import op
import sqlalchemy as sa

revision = "m9i0j1k2l3m4"
down_revision = "l8h9i0j1k2l3"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "admin_user",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(255), server_default=""),
        sa.Column("password_hash", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("mfa_enabled", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_admin_user_email", "admin_user", ["email"])
    op.create_table(
        "admin_role",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("key", sa.String(50), nullable=False, unique=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.Text, server_default=""),
    )
    op.create_table(
        "admin_role_assignment",
        sa.Column("admin_user_id", sa.dialects.postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("admin_user.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role_id", sa.Integer,
                  sa.ForeignKey("admin_role.id", ondelete="CASCADE"), primary_key=True),
    )
    op.execute("""
        INSERT INTO admin_role (key, name, description) VALUES
          ('super_admin','Super Admin','Full access'),
          ('support','Support','Read + impersonate + reset quotas'),
          ('finance','Finance','Billing and revenue'),
          ('marketing','Marketing','Growth and usage read'),
          ('operations','Operations','Queue, providers, flags'),
          ('developer','Developer','System, flags, integrations'),
          ('auditor','Auditor','Read-only, no mutations')
        ON CONFLICT (key) DO NOTHING
    """)


def downgrade():
    op.drop_table("admin_role_assignment")
    op.drop_table("admin_role")
    op.drop_index("ix_admin_user_email", table_name="admin_user")
    op.drop_table("admin_user")
